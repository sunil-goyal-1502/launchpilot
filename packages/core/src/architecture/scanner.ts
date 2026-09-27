import { dirname, basename, posix } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseAllDocuments, LineCounter } from 'yaml';
import type { Node as YAMLNode } from 'yaml';
import type { ArchitectureResource, DeploymentFormat, RepositoryArchitecture, ResourceKind } from '../types/architecture';
import { collectRepositoryFiles, hash, safeName, sensitiveKey, type RepoFile } from './files';
import { declarationBlocks } from './blocks';
import { redactDeploymentObject, redactText } from './redaction';
import { readTypeScriptConnections, codeOffsets } from './source-reader';
import { appendCortexArchitecture, isCortexDefinition } from './cortex-reader';

function classify(type: string): ResourceKind {
  if (/secret(?!smanager)/i.test(type)) return 'secret';
  if (/key.?vault|secretsmanager|vaults?\b/i.test(type)) return 'vault';
  if (/redis|memcached|elasticache/i.test(type)) return 'cache';
  if (/kafka|kinesis|eventhub|pulsar/i.test(type)) return 'streaming';
  if (/servicebus|rabbitmq|sqs|queue/i.test(type)) return 'queue';
  if (/postgres|mysql|mariadb|mongo|cosmos|dynamodb|rds|sql|database/i.test(type)) return 'database';
  if (/storage|bucket|s3_|persistentvolume|volume/i.test(type)) return 'storage';
  if (/identity|role|iam_|serviceaccount|policy/i.test(type)) return 'identity';
  if (/network|subnet|vpc|security.?group|ingress|load.?balanc|route|dns|firewall|public.?ip/i.test(type)) return 'network';
  if (/configmap|configstore|parameter/i.test(type)) return 'configuration';
  if (/container|deployment|statefulset|daemonset|job|pod|function|lambda|instance|virtualmachine|webapp|ecs_|linux_web_app/i.test(type)) return 'application';
  return 'unknown';
}
type Dict = Record<string, any>;
interface Pending { from: string; scope: string; reference: string; relationship: string; evidence: string; format: string }

export async function scanRepositoryArchitecture(root: string, repoUrl: string, options: Parameters<typeof collectRepositoryFiles>[1] = {}): Promise<RepositoryArchitecture> {
  const inventory = await collectRepositoryFiles(root, options);
  const { files } = inventory;
  let revision: string | null = null;
  try { revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim(); } catch { /* local non-git repository */ }
  const graph: RepositoryArchitecture = {
    version: 1, id: hash(files.map(f => `${f.path}:${f.sha256}`).join('\n') + JSON.stringify(inventory.excluded)), repoUrl, revision, scannedAt: new Date().toISOString(),
    resources: [], connections: [], bindings: [], evidence: [], deploymentUnits: [], gaps: [], recommendations: [], deploymentContext: [],
    coverage: { filesScanned: files.length, deploymentFiles: 0, files: files.map(({ path, sha256, category }) => ({ path, sha256, category })), excluded: inventory.excluded, limits: inventory.limits, truncated: inventory.truncated, runtimeVerified: false },
  };
  const pending: Pending[] = [];
  const cortexFiles: RepoFile[] = [];
  const chartRoots = files.filter(f => basename(f.path) === 'Chart.yaml').map(f => dirname(f.path));
  const symbols = new Map<string, string>();
  const evidence = (file: RepoFile, start: number, end: number, summary: string, kind: 'deployment' | 'code' | 'configuration' = 'deployment') => {
    const line = file.content.slice(0, start).split('\n').length;
    const endLine = file.content.slice(0, end).split('\n').length;
    const id = 'ev-' + hash(`${file.path}:${line}:${endLine}:${summary}`).slice(0, 16);
    if (!graph.evidence.some(e => e.id === id)) graph.evidence.push({ id, file: file.path, line, endLine, kind, summary });
    return id;
  };
  const gap = (code: string, message: string, refs: string[], scope?: string, severity: 'warning' | 'blocker' = 'warning') => {
    const id = 'gap-' + hash(`${code}:${message}:${refs.join(',')}`).slice(0, 16);
    if (!graph.gaps.some(g => g.id === id)) graph.gaps.push({ id, severity, code, message, evidence: refs, scope });
  };
  const add = (id: string, name: string, kind: ResourceKind, technology: string, scope: string, ev: string, attributes: Record<string, string> = {}, origin: ArchitectureResource['origin'] = 'declared') => {
    const old = graph.resources.find(r => r.id === id);
    if (old) { if (!old.evidence.includes(ev)) old.evidence.push(ev); return id; }
    graph.resources.push({ id, name: safeName(name), kind, technology: safeName(technology), scope, origin, evidence: [ev], attributes });
    return id;
  };
  const edge = (from: string, to: string, relationship: string, ev: string) => {
    const id = 'edge-' + hash(`${from}:${to}:${relationship}`).slice(0, 16);
    const existing = graph.connections.find(e => e.id === id);
    if (existing) { if (!existing.evidence.includes(ev)) existing.evidence.push(ev); }
    else graph.connections.push({ id, from, to, relationship, evidence: [ev] });
  };
  const unit = (file: RepoFile, format: DeploymentFormat, scope: string, resourceIds: string[]) => {
    const id = `${format}:${scope}`;
    const old = graph.deploymentUnits.find(u => u.id === id);
    if (old) { if (!old.files.includes(file.path)) old.files.push(file.path); old.resourceIds.push(...resourceIds.filter(r => !old.resourceIds.includes(r))); }
    else graph.deploymentUnits.push({ id, name: scope, root: dirname(file.path), format, files: [file.path], resourceIds, exportFormats: format === 'terraform' ? ['terraform'] : format === 'bicep' ? ['bicep'] : format === 'kubernetes' ? ['terraform'] : [] });
  };
  const bind = (consumerId: string, key: string, value: unknown, ev: string, scope: string, source?: 'secret' | 'config-map' | 'file', sourceName?: string, sourceKey?: string, format = '') => {
    if (!/^[\w.:-]{1,180}$/.test(key)) return;
    const id = `binding:${consumerId}:${key}`;
    const string = typeof value === 'string' ? value : '';
    const envRef = /\$\{([A-Za-z_]\w*)(?::?[-?][^}]*)?\}/.exec(string);
    const expression = /\$\{|\[.*\]|\{\{|\b(?:var|local|module)\./.test(string);
    const sourceId = sourceName ? `config:${scope}:${source}:${sourceName}` : undefined;
    graph.bindings.push({ id, consumerId, key, source: source ?? (envRef ? 'environment' : expression ? 'expression' : 'literal'), sourceId, sourceKey: sourceKey ?? envRef?.[1], sensitive: sensitiveKey(key) || source === 'secret', evidence: [ev], resolved: !sourceName && !envRef && !expression });
    if (sourceId) {
      const actual = symbols.get(`${format}:${scope}:${source}:${sourceName}`);
      if (actual) { graph.bindings.at(-1)!.sourceId = actual; graph.bindings.at(-1)!.resolved = true; edge(actual, consumerId, `supplies ${key}${sourceKey ? ` from key ${sourceKey}` : ''}`, ev); }
      else pending.push({ from: consumerId, scope, reference: `${source}:${sourceName}`, relationship: `loads ${key}${sourceKey ? ` from key ${sourceKey}` : ''}`, evidence: ev, format });
    }
    if (envRef) gap('configuration-input', `${key} is supplied through ${envRef[1]}; its deployment-time provider must be specified in the target design.`, [ev], scope);
    if (source === 'file') gap('configuration-file', `${key} is supplied by a file; preserve its mount and delivery mechanism in the target design.`, [ev], scope);
    if (format === 'compose' && string) {
      try {
        const url = new URL(string);
        if (url.hostname && !/\$|\{|\}/.test(url.hostname)) pending.push({ from: consumerId, scope, reference: url.hostname, relationship: `connects using ${key} (${url.protocol.replace(':', '')})`, evidence: ev, format });
      } catch {
        if (/^[A-Za-z][\w.-]*$/.test(string) && /host|server/i.test(key)) pending.push({ from: consumerId, scope, reference: string, relationship: `connects using ${key}`, evidence: ev, format });
      }
    }
  };

  for (const file of files) {
    if (/\.(?:env\.(?:example|sample|template)|properties)$/.test(file.path) || /(^|\/)\.env\.(?:example|sample|template)$/.test(file.path)) {
      const ev = evidence(file, 0, file.content.length, 'Configuration template; values are not proof of deployed configuration', 'configuration');
      const id = add(`configuration:${file.path}`, file.path, 'configuration', 'Configuration template', dirname(file.path), ev, { template: 'true' }, 'code');
      for (const match of file.content.matchAll(/^\s*([A-Za-z_][\w.-]*)\s*=/gm)) {
        const ref = evidence(file, match.index!, match.index! + match[0].length, `Declares configuration key ${match[1]}`, 'configuration');
        graph.bindings.push({ id: `template:${file.path}:${match[1]}`, consumerId: id, key: match[1], source: 'environment', sensitive: sensitiveKey(match[1]), evidence: [ref], resolved: false });
      }
    }
    // HCL and Bicep declarations, preserving scope and explicit symbolic references.
    if (file.category === 'terraform' || file.category === 'bicep') {
      const language = file.category as 'terraform' | 'bicep';
      const scope = dirname(file.path);
      const ids: string[] = [];
      let redacted = redactText(file.content);
      // Defaults inside credential variable/parameter declarations are never evidence values.
      for (const block of declarationBlocks(file.content, language)) if (block.keyword === 'variable' && (sensitiveKey(block.labels[0]) || /sensitive\s*=\s*true/.test(block.body))) redacted = redacted.replace(block.body, block.body.replace(/default\s*=[^\n]+/g, 'default = "[REDACTED]"'));
      graph.deploymentContext.push({ file: file.path, content: redacted, redacted: true });
      if (file.path.endsWith('.tf.json')) {
        try {
          const json = JSON.parse(file.content);
          for (const keyword of ['resource', 'data', 'module']) for (const [type, group] of Object.entries(json[keyword] ?? {})) {
            for (const name of keyword === 'module' ? [type] : Object.keys(group as Dict)) {
              const ev = evidence(file, 0, file.content.length, `${keyword} ${type}.${name} declared in Terraform JSON`);
              const address = keyword === 'module' ? `module.${name}` : `${keyword === 'data' ? 'data.' : ''}${type}.${name}`;
              const id = add(`tf:${scope}:${address}`, address, keyword === 'module' ? 'module' : classify(type), type, scope, ev);
              symbols.set(`terraform:${scope}:${address}`, id); ids.push(id);
            }
          }
          gap('terraform-json-expressions', 'Terraform JSON declarations are inventoried; expression dependencies require the target-plan review.', [evidence(file, 0, file.content.length, 'Terraform JSON deployment')], scope);
        } catch { gap('parse-error', `Cannot parse ${file.path} as Terraform JSON.`, [], scope, 'blocker'); }
      } else {
        const blocks = declarationBlocks(file.content, language);
        for (const block of blocks) {
          if (!['resource', 'data', 'module'].includes(block.keyword)) continue;
          const type = language === 'terraform' ? block.labels[0] : block.labels[1];
          const name = language === 'terraform' ? block.labels[1] ?? block.labels[0] : block.labels[0];
          const address = language === 'terraform' ? block.keyword === 'module' ? `module.${name}` : `${block.keyword === 'data' ? 'data.' : ''}${type}.${name}` : name;
          const ev = evidence(file, block.start, block.end, `${block.keyword} ${address} (${type})`);
          const id = add(`${language}:${scope}:${address}`, address, block.keyword === 'module' ? 'module' : classify(type), type, scope, ev,
            { declaration: block.keyword, ...(block.keyword === 'module' ? { source: safeName(/source\s*=\s*"([^"\n]+)"/.exec(block.body)?.[1] ?? (language === 'bicep' ? type : undefined)) } : {}) }, block.keyword === 'data' ? 'external' : 'declared');
          ids.push(id); symbols.set(`${language}:${scope}:${address}`, id);
          if (block.keyword === 'module') gap('module-boundary', `Module ${address} must be retained or expanded before changing its resources.`, [ev], scope);
          if (/\b(count|for_each)\s*=|\[\s*for\b/.test(block.body)) gap('dynamic-topology', `The instance count for ${address} depends on an expression; preserve that expression in the target plan.`, [ev], scope);
          const refs = language === 'terraform' ? /\b((?:data\.)?(?:aws|azurerm|azapi|google|kubernetes|helm|random|module)_[\w]+\.[\w]+|module\.[\w]+|data\.[\w]+\.[\w]+)\b/g : /\b([A-Za-z_]\w*)\.(?:id|name|properties|outputs)\b/g;
          for (const match of block.body.matchAll(refs)) if (match[1] !== address) pending.push({ from: id, scope, reference: match[1], relationship: 'references', evidence: ev, format: language });
          for (const match of block.body.matchAll(/(?:"([A-Z][A-Z0-9_]+)"|'([A-Z][A-Z0-9_]+)')\s*[:=]\s*([^\n]+)/g)) {
            bind(id, match[1] ?? match[2], match[3], ev, scope);
          }
        }
        const declarationCount = [...file.content.matchAll(/^\s*(resource|data|module)\s+/gm)].length;
        if (declarationCount > blocks.filter(b => ['resource', 'data', 'module'].includes(b.keyword)).length) gap('dynamic-declaration', `${file.path} contains declarations not resolved by the lexical inventory; retain and review the original file.`, [evidence(file, 0, file.content.length, 'Dynamic deployment declarations')], scope);
      }
      unit(file, language, scope, ids);
      continue;
    }

    if (file.category === 'yaml' || file.path.endsWith('.json')) {
      // Azure Pipelines expressions are not Helm templates. Keep CI evidence in its own scope.
      const workflowRoot = /^(.*(?:^|\/)azure-pipelines)(?:\/|[^/]*\.ya?ml$)/.exec(file.path)?.[1];
      if (workflowRoot || /(?:^|\/)\.github\/workflows\//.test(file.path)) {
        unit(file, 'workflow', workflowRoot ?? file.path, []);
        graph.deploymentContext.push({ file: file.path, content: redactText(file.content), redacted: true });
        evidence(file, 0, file.content.length, 'CI/CD workflow is part of deployment evidence');
        continue;
      }
      const chartRoot = chartRoots.find(root => file.path.startsWith(root + '/'));
      if (/\{[{%]/.test(file.content) && chartRoot) {
        const ev = evidence(file, 0, file.content.length, 'Unrendered Helm template');
        unit(file, 'helm', chartRoot, []);
        graph.deploymentContext.push({ file: file.path, content: redactText(file.content), redacted: true });
        gap('helm-values', 'Render this chart with the selected values and release namespace to establish its concrete resource graph.', [ev], chartRoot);
        continue;
      }
      try {
        const counter = new LineCounter();
        const docs = parseAllDocuments(file.content, { lineCounter: counter, uniqueKeys: true });
        for (const doc of docs) {
          if (doc.errors.length) { if (file.category === 'yaml') gap('parse-error', `Cannot fully parse ${file.path}; review the original deployment/configuration.`, [evidence(file, 0, file.content.length, 'YAML parsing failed')], file.path, 'blocker'); continue; }
          const data = doc.toJS({ maxAliasCount: 50 }) as Dict;
          if (!data || typeof data !== 'object') continue;
          if (data.apiVersion || data.services || data.$schema?.includes('deploymentTemplate') || /chart|helm|values|\.github\/workflows|azure-pipelines/i.test(file.path)) graph.deploymentContext.push({ file: file.path, content: JSON.stringify(redactDeploymentObject(data)), redacted: true });
          if (isCortexDefinition(data)) { if (!cortexFiles.includes(file)) cortexFiles.push(file); continue; }
          const evAt = (path: Array<string | number>, summary: string) => {
            const node = doc.getIn(path, true) as YAMLNode | undefined;
            return evidence(file, node?.range?.[0] ?? doc.range?.[0] ?? 0, node?.range?.[1] ?? doc.range?.[1] ?? file.content.length, summary);
          };
          if (data.services && /(?:^|\/)(?:docker-)?compose[^/]*\.ya?ml$/i.test(file.path)) {
            const scope = file.path, ids: string[] = [];
            for (const [name, service] of Object.entries<Dict>(data.services)) {
              if (!service || typeof service !== 'object') continue;
              const ev = evAt(['services', name], `Compose service ${name}`);
              const image = safeName(service.image, 'build required');
              const kind = classify(image) === 'unknown' ? 'application' : classify(image);
              const context = typeof service.build === 'string' ? service.build : service.build?.context;
              const id = add(`compose:${scope}:${name}`, name, kind, image, scope, ev,
                { ...(context ? { buildContext: safeName(posix.normalize(posix.join(dirname(file.path), context))) } : {}), ...(service.image ? { image } : {}), ...(service.ports ? { publishedPorts: JSON.stringify(service.ports.map((p: any) => typeof p === 'object' ? { target: p.target, published: p.published } : p)) } : {}) });
              symbols.set(`compose:${scope}:${name}`, id); ids.push(id);
              for (const target of Array.isArray(service.depends_on) ? service.depends_on : Object.keys(service.depends_on ?? {})) pending.push({ from: id, scope, reference: target, relationship: 'startup dependency', evidence: evAt(['services', name, 'depends_on'], `${name} depends_on ${target}`), format: 'compose' });
              const env = Array.isArray(service.environment) ? Object.fromEntries(service.environment.map((v: string) => { const p = v.indexOf('='); return p === -1 ? [v, '${' + v + '}'] : [v.slice(0, p), v.slice(p + 1)]; })) : service.environment ?? {};
              for (const [key, value] of Object.entries(env)) bind(id, key, value === null ? '${' + key + '}' : value, evAt(['services', name, 'environment', key], `${name} environment variable ${key}`), scope, undefined, undefined, undefined, 'compose');
              for (const path of (Array.isArray(service.env_file) ? service.env_file : service.env_file ? [service.env_file] : [])) bind(id, 'env_file', undefined, evAt(['services', name, 'env_file'], `${name} reads an environment file`), scope, 'file', safeName(typeof path === 'string' ? path : path.path), undefined, 'compose');
              for (const secret of service.secrets ?? []) bind(id, safeName(typeof secret === 'string' ? secret : secret.target ?? secret.source), undefined, evAt(['services', name, 'secrets'], `${name} mounts a Compose secret`), scope, 'secret', safeName(typeof secret === 'string' ? secret : secret.source), undefined, 'compose');
              for (const volume of service.volumes ?? []) {
                const source = typeof volume === 'string' ? volume.split(':')[0] : volume.source;
                const local = typeof volume === 'object' ? volume.type === 'bind' : /^(?:\.{1,2}\/|~\/|\/|[A-Za-z]:[\\/])/.test(source);
                if (local || !source) {
                  const resource = graph.resources.find(r => r.id === id)!;
                  const mounts = JSON.parse(resource.attributes.localMounts ?? '[]');
                  mounts.push(redactDeploymentObject(volume)); resource.attributes.localMounts = JSON.stringify(mounts);
                  evAt(['services', name, 'volumes'], `${name} local filesystem mount; not a provisioned storage resource`);
                  continue;
                }
                if (source) pending.push({ from: id, scope, reference: `volume:${source}`, relationship: 'mounts storage', evidence: evAt(['services', name, 'volumes'], `${name} volume mount`), format: 'compose' });
              }
            }
            for (const [key, kind] of [['volumes', 'storage'], ['networks', 'network'], ['secrets', 'secret'], ['configs', 'configuration']] as const) {
              for (const name of Object.keys(data[key] ?? {})) {
                const ev = evAt([key, name], `Compose ${key} ${name}`);
                const id = add(`compose:${scope}:${key}:${name}`, name, kind, `Compose ${key}`, scope, ev);
                symbols.set(`compose:${scope}:${key === 'secrets' ? 'secret' : key === 'volumes' ? 'volume' : key}:${name}`, id); ids.push(id);
                if (data[key][name]?.external) graph.resources.find(r => r.id === id)!.origin = 'external';
              }
            }
            unit(file, 'compose', scope, ids);
          } else if (data.apiVersion && data.kind) {
            const items = data.kind === 'List' && Array.isArray(data.items) ? data.items : [data];
            const ids: string[] = [];
            for (const obj of items) {
              const name = safeName(obj.metadata?.name), namespace = safeName(obj.metadata?.namespace, '(deployment namespace)');
              const scope = `${dirname(file.path)}::${namespace}`;
              const ev = evAt([], `Kubernetes ${obj.kind} ${name} in ${namespace}`);
              const id = add(`k8s:${scope}:${obj.kind}:${name}`, name, classify(obj.kind) === 'unknown' ? 'service' : classify(obj.kind), `${obj.apiVersion}/${obj.kind}`, scope, ev,
                { namespace, kind: safeName(obj.kind) });
              ids.push(id);
              const short = obj.kind === 'Secret' ? 'secret' : obj.kind === 'ConfigMap' ? 'config-map' : obj.kind;
              symbols.set(`kubernetes:${scope}:${short}:${name}`, id);
              const pod = obj.spec?.template?.spec ?? obj.spec?.jobTemplate?.spec?.template?.spec ?? (obj.kind === 'Pod' ? obj.spec : undefined);
              for (const container of [...(pod?.containers ?? []), ...(pod?.initContainers ?? [])]) {
                if (container.image) graph.resources.find(r => r.id === id)!.attributes[`image:${safeName(container.name)}`] = safeName(container.image);
                for (const item of container.env ?? []) {
                  const secret = item.valueFrom?.secretKeyRef, config = item.valueFrom?.configMapKeyRef;
                  bind(id, safeName(item.name), item.value, ev, scope, secret ? 'secret' : config ? 'config-map' : undefined, secret?.name ?? config?.name, secret?.key ?? config?.key, 'kubernetes');
                }
                for (const source of container.envFrom ?? []) {
                  const ref = source.secretRef ?? source.configMapRef;
                  if (ref) bind(id, 'envFrom', undefined, ev, scope, source.secretRef ? 'secret' : 'config-map', ref.name, undefined, 'kubernetes');
                }
              }
              if (pod?.serviceAccountName) pending.push({ from: id, scope, reference: `ServiceAccount:${pod.serviceAccountName}`, relationship: 'uses identity', evidence: ev, format: 'kubernetes' });
              for (const volume of pod?.volumes ?? []) {
                if (volume.secret) pending.push({ from: id, scope, reference: `secret:${volume.secret.secretName}`, relationship: 'mounts secret', evidence: ev, format: 'kubernetes' });
                if (volume.configMap) pending.push({ from: id, scope, reference: `config-map:${volume.configMap.name}`, relationship: 'mounts configuration', evidence: ev, format: 'kubernetes' });
                if (volume.persistentVolumeClaim) pending.push({ from: id, scope, reference: `PersistentVolumeClaim:${volume.persistentVolumeClaim.claimName}`, relationship: 'mounts storage', evidence: ev, format: 'kubernetes' });
                if (volume.csi?.volumeAttributes?.secretProviderClass) pending.push({ from: id, scope, reference: `SecretProviderClass:${volume.csi.volumeAttributes.secretProviderClass}`, relationship: 'mounts secrets through CSI', evidence: ev, format: 'kubernetes' });
              }
              if (obj.kind === 'SecretProviderClass') {
                const vaultName = safeName(obj.spec?.parameters?.keyvaultName);
                if (vaultName !== 'unresolved') {
                  const vault = add(`vault:${scope}:${vaultName}`, vaultName, 'vault', 'Azure Key Vault', scope, ev, {}, 'external');
                  ids.push(vault);
                  edge(vault, id, 'supplies CSI secrets', ev);
                }
                if (obj.spec?.parameters?.userAssignedIdentityID || obj.spec?.parameters?.clientID) {
                  const identity = add(`identity:${id}`, `${name} identity`, 'identity', 'Azure managed identity reference', scope, ev, {}, 'external'); ids.push(identity); edge(id, identity, 'authenticates using', ev);
                }
                for (const secret of obj.spec?.secretObjects ?? []) {
                  const target = add(`k8s:${scope}:Secret:${safeName(secret.secretName)}`, safeName(secret.secretName), 'secret', 'CSI-synchronized Kubernetes Secret', scope, ev);
                  symbols.set(`kubernetes:${scope}:secret:${secret.secretName}`, target); edge(id, target, 'synchronizes secret', ev); ids.push(target);
                }
              }
              if (obj.kind === 'ExternalSecret') {
                const target = safeName(obj.spec?.target?.name, name);
                const secret = add(`k8s:${scope}:Secret:${target}`, target, 'secret', 'External Secrets-managed Kubernetes Secret', scope, ev);
                symbols.set(`kubernetes:${scope}:secret:${target}`, secret); edge(id, secret, 'synchronizes secret', ev); ids.push(secret);
                if (obj.spec?.secretStoreRef?.name) pending.push({ from: id, scope, reference: `${obj.spec.secretStoreRef.kind ?? 'SecretStore'}:${obj.spec.secretStoreRef.name}`, relationship: 'retrieves external secrets', evidence: ev, format: 'kubernetes' });
              }
              if (obj.kind === 'Service' && obj.spec?.selector) {
                graph.resources.find(r => r.id === id)!.attributes.selector = JSON.stringify(obj.spec.selector);
              }
              const labels = obj.spec?.template?.metadata?.labels ?? (obj.kind === 'Pod' ? obj.metadata?.labels : undefined);
              if (labels) graph.resources.find(r => r.id === id)!.attributes.podLabels = JSON.stringify(labels);
              if (obj.kind === 'Ingress') for (const rule of obj.spec?.rules ?? []) for (const path of rule.http?.paths ?? []) if (path.backend?.service?.name) pending.push({ from: id, scope, reference: `Service:${path.backend.service.name}`, relationship: 'routes HTTP to', evidence: ev, format: 'kubernetes' });
            }
            unit(file, 'kubernetes', dirname(file.path), ids);
          } else if (data.$schema?.includes('deploymentTemplate') && data.resources) {
            const ids: string[] = [];
            const arm = (resources: Dict[], parent = '') => {
              for (const resource of resources) {
                const name = safeName(resource.name), type = safeName(resource.type);
                const ev = evAt(['resources'], `ARM resource ${type} ${name}`);
                ids.push(add(`arm:${file.path}:${parent}/${name}`, name, classify(type), type, file.path, ev));
                if (resource.resources) arm(resource.resources, `${parent}/${name}`);
              }
            };
            arm(Array.isArray(data.resources) ? data.resources : Object.values(data.resources)); unit(file, 'arm', file.path, ids);
          } else if (basename(file.path) === 'Chart.yaml' || /(?:^|\/)values(?:[.-][^/]*)?\.ya?ml$/.test(file.path)) {
            unit(file, 'helm', dirname(file.path), []);
          } else if (/\.github\/workflows\//.test(file.path) || /azure-pipelines[^/]*\.ya?ml$/.test(file.path)) {
            unit(file, 'workflow', file.path, []);
            evidence(file, 0, file.content.length, 'CI/CD workflow is part of deployment evidence');
          } else if (/^(?:appsettings|application|config)(?:[.-].*)?\.(?:json|ya?ml)$/.test(basename(file.path))) {
            const ev = evAt([], 'Application configuration definition; environment precedence must be reviewed');
            const id = add(`configuration:${file.path}`, file.path, 'configuration', 'Application configuration file', dirname(file.path), ev, {}, 'code');
            const entries = (obj: Dict, path: string[] = []) => {
              for (const [key, value] of Object.entries(obj)) {
                if (value && typeof value === 'object' && !Array.isArray(value)) entries(value, [...path, key]);
                else bind(id, [...path, key].join('.'), value, evAt([...path, key], `Configuration key ${[...path, key].join('.')}`), dirname(file.path));
              }
            };
            entries(data);
            graph.deploymentContext.push({ file: file.path, content: JSON.stringify(redactDeploymentObject(data)), redacted: true });
          }
        }
      } catch { if (file.category === 'yaml') gap('parse-error', `Could not safely read ${file.path}.`, [evidence(file, 0, file.content.length, 'YAML parsing failed')], file.path, 'blocker'); }
    }

    if (file.category === 'docker') {
      const ev = evidence(file, 0, file.content.length, 'Docker build definition; base image is not the deployable application image');
      const id = add(`docker:${file.path}`, file.path, 'application', 'Docker build definition', dirname(file.path), ev,
        { exposedPorts: [...file.content.matchAll(/^\s*EXPOSE\s+([^\n]+)/gm)].map(m => safeName(m[1])).join(', ') }, 'code');
      graph.deploymentContext.push({ file: file.path, content: redactText(file.content), redacted: true });
      gap('image-delivery', `Build and publish ${file.path}; use the resulting immutable image reference in the target deployment.`, [ev], dirname(file.path));
    }

    // Source observations: exact environment reads and explicit SDK imports, not dependency-name guesses.
    if (/\.(?:[cm]?[jt]sx?|py|go|java|cs|rb|php|rs|prisma|properties)$/i.test(file.path) && !/(^|\/)(?:tests?|__tests__|fixtures)\/|\.(test|spec)\./i.test(file.path)) {
      const patterns = [
        /\bprocess\.env(?:\.([A-Za-z_]\w*)|\[['"]([A-Za-z_]\w*)['"]\])/g,
        /\b(?:os\.(?:getenv|environ\.get)|os\.environ\[|os\.Getenv|System\.getenv|Environment\.GetEnvironmentVariable|ENV\[|env)\s*\(?\s*['"]([A-Za-z_]\w*)['"]/g,
        /\b(?:GetConnectionString|GetSecretAsync|getSecret)\s*\(\s*['"]([\w.-]+)['"]/g,
      ];
      const ast = /\.[cm]?[jt]sx?$/.test(file.path) ? readTypeScriptConnections(file.path, file.content) : undefined;
      const allowed = ast ? undefined : codeOffsets(file.content, /\.(py|rb|properties)$/.test(file.path));
      // Other languages use explicit literal access patterns. Their dynamic/inter-file data flow is not evaluated.
      const observations = ast ? ast.reads.map(read => ({ key: read.key, start: read.start, end: read.end, index: read.kind === 'secret' ? 2 : 0, client: read.client })) : patterns.flatMap((pattern, index) => [...file.content.matchAll(pattern)].filter(match => allowed![match.index!]).map(match => ({ key: match[1] ?? match[2], start: match.index!, end: match.index! + match[0].length, index, client: undefined })));
      const imports = ast?.imports ?? [...file.content.matchAll(/(?:from\s*['"]|require\(['"]|import\s+|using\s+)([^'"\s;)]+)/g)].filter(m => /^(?:boto3|psycopg|pymongo|redis|azure\.|Azure\.|StackExchange\.Redis|Npgsql|pika|celery)/.test(m[1])).map(m => ({ library: m[1], start: m.index!, end: m.index! + m[0].length }));
      if (observations.length || imports.length) {
        const ev = evidence(file, 0, Math.min(file.content.length, 1), 'Source file with resource/configuration access', 'code');
        const component = add(`code:${file.path}`, file.path, 'application', 'Source code', dirname(file.path), ev, {}, 'code');
        for (const { key, start, end, index, client } of observations) {
          const ref = evidence(file, start, end, index === 2 ? `Calls secret/connection-string accessor for ${key}` : `Reads environment variable ${key}${client ? ` passed to ${client}` : ''}`, 'code');
          graph.bindings.push({ id: `read:${file.path}:${start}`, consumerId: component, key, source: index === 2 ? 'secret' : 'environment', sensitive: index === 2 || sensitiveKey(key), evidence: [ref], resolved: false });
          if (client) edge(component, `client:${client}`, `passes ${key} to client constructor/call`, ref);
          const supplied = graph.bindings.filter(b => b.key === key && b.consumerId !== component && graph.resources.find(r => r.id === b.consumerId)?.origin === 'declared');
          const mapped = supplied.filter(b => {
            const buildContext = graph.resources.find(r => r.id === b.consumerId)?.attributes.buildContext;
            return buildContext !== undefined && (buildContext === '.' || file.path.startsWith(buildContext + '/'));
          });
          if (mapped.length === 1) {
            graph.bindings.at(-1)!.resolved = true; graph.bindings.at(-1)!.sourceId = mapped[0].consumerId;
            edge(mapped[0].consumerId, component, `supplies ${key} to code in build context`, ref);
          } else gap('code-configuration-provider', `Specify how ${key} reaches ${file.path}${supplied.length ? '; the same name occurs in deployment configuration, but source-to-workload ownership is not established' : ''}.`, [ref], dirname(file.path));
        }
        for (const match of imports) {
          const ev = evidence(file, match.start, match.end, `Imports resource client ${match.library}`, 'code');
          const client = add(`client:${match.library}`, match.library, 'service', 'Client library (not a provisioned resource)', 'code', ev, {}, 'code');
          edge(component, client, 'imports client library', ev);
        }
      }
    }
  }

  appendCortexArchitecture(graph, cortexFiles, classify);
  for (const p of pending) {
    const target = symbols.get(`${p.format}:${p.scope}:${p.reference}`);
    if (target) {
      edge(p.from, target, p.relationship, p.evidence);
      for (const b of graph.bindings.filter(b => b.consumerId === p.from && b.evidence.includes(p.evidence) && b.sourceId?.includes(p.reference))) { b.sourceId = target; b.resolved = true; }
    } else {
      const external = add(`external:${p.format}:${p.scope}:${p.reference}`, p.reference, p.reference.startsWith('secret:') ? 'secret' : p.reference.startsWith('volume:') ? 'storage' : 'unknown', 'Referenced; definition not located in this deployment scope', p.scope, p.evidence, {}, 'external');
      edge(p.from, external, p.relationship, p.evidence);
      gap('external-reference', `Define or explicitly retain ${p.reference} as an external dependency in the selected architecture.`, [p.evidence], p.scope);
    }
  }
  for (const module of graph.resources.filter(r => r.kind === 'module' && /^(\.\/|\.\.\/)/.test(r.attributes.source ?? ''))) {
    const root = posix.normalize(posix.join(module.scope, module.attributes.source));
    const matching = graph.resources.filter(r => r.id !== module.id && (r.scope === root || (root.endsWith('.bicep') && r.evidence.some(id => graph.evidence.find(e => e.id === id)?.file === root))));
    for (const child of matching) edge(module.id, child.id, 'includes local module declaration', module.evidence[0]);
  }
  for (const service of graph.resources.filter(r => r.attributes.selector)) {
    const selector = JSON.parse(service.attributes.selector);
    for (const workload of graph.resources.filter(r => r.scope === service.scope && r.attributes.podLabels)) {
      const labels = JSON.parse(workload.attributes.podLabels);
      if (Object.keys(selector).length && Object.entries(selector).every(([key, value]) => labels[key] === value)) edge(service.id, workload.id, 'selects pods by labels', service.evidence[0]);
    }
  }
  if (inventory.truncated) gap('scan-limit', 'The repository exceeds the scan limits; increase the limits before claiming full source coverage.', [], undefined, 'blocker');
  // Every uncertainty drives a concrete recommendation; recommendations never become observations.
  for (const issue of graph.gaps) graph.recommendations.push({
    id: `rec:${issue.id}`, title: issue.code === 'configuration-input' || issue.code === 'code-configuration-provider' ? 'Complete configuration delivery' : issue.code === 'external-reference' ? 'Resolve the dependency boundary' : 'Complete deployment evidence',
    rationale: issue.message,
    action: issue.code.includes('configuration') ? 'Add an explicit configuration input to the target plan. Route credentials through the selected secret store and record the consuming workload, identity and variable name.' : issue.code === 'helm-values' ? 'Keep Helm as the deployment owner and include the selected chart, values, namespace and externally managed resources in the plan.' : 'Use the cited definition in the architecture review; recommend an explicit managed or external resource rather than substituting one silently.',
    evidence: issue.evidence,
  });
  const deploymentPaths = new Set(graph.deploymentUnits.flatMap(u => u.files));
  graph.coverage.deploymentFiles = deploymentPaths.size;
  // Content-address the actual analysis, including parser results and selection boundaries.
  graph.id = hash(JSON.stringify({ ...graph, id: undefined, scannedAt: undefined }));
  return graph;
}

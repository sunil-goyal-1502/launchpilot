import { sensitiveKey } from './files';

const REDACTED = '[REDACTED: supply securely at deployment]';
const referenceName = /^(?:secretName|secretKey|secretKeyRef|secretRef|secretProviderClass|keyvaultName)$/i;
const expression = /^\$\([A-Za-z_]\w*\)$|^\$\{|^\{\{|^\[/;
/** Retain deployment structure and expressions; never forward literal credentials to the model/UI. */
export function redactDeploymentObject(value: unknown, secretDocument = false): unknown {
  if (Array.isArray(value)) return value.map(v => redactDeploymentObject(v, secretDocument));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? redactText(value) : value;
  const obj = value as Record<string, unknown>;
  const secret = obj.kind === 'Secret' || secretDocument;
  const entrySecret = typeof obj.name === 'string' && sensitiveKey(obj.name);
  return Object.fromEntries(Object.entries(obj).map(([key, child]) => {
    if ((secret && ['data', 'stringData'].includes(key)) || (entrySecret && key === 'value' && !(typeof child === 'string' && expression.test(child)))) return [key, typeof child === 'object' && child ? Object.fromEntries(Object.keys(child).map(k => [k, REDACTED])) : REDACTED];
    if (sensitiveKey(key) && !referenceName.test(key) && typeof child === 'string' && !expression.test(child)) return [key, REDACTED];
    return [key, redactDeploymentObject(child)];
  }));
}
export function redactText(text: string): string {
  return text
    .replace(/-----BEGIN [\w ]*PRIVATE KEY-----[\s\S]*?-----END [\w ]*PRIVATE KEY-----/g, REDACTED)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/'"<>]+@)/gi, '$1[REDACTED]@')
    .replace(/((?:AccountKey|SharedAccessKey|Password|AccessToken)=)[^;\s'"}]+/gi, '$1[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g, REDACTED)
    .replace(/([?&](?:sig|token|key|api_key|access_token)=)[^&\s'"<>]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|token|api_?key|connection_?string)\w*\s*[:=]\s*)(['"])(?!\$\{|\[|\{\{)([^'"\n]+)\2/gi, `$1'${REDACTED}'`);
}

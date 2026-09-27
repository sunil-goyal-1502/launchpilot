'use client';

import { useRouter } from 'next/navigation';
import { useDeployWizard } from '@/hooks/use-deploy-wizard';
import { StepRepo } from './step-repo';
import { StepBlueprint } from './step-blueprint';
import { StepCloud } from './step-cloud';
import { StepConfirm } from './step-confirm';

const STEP_LABELS = ['Repository & cloud', 'Architecture'];

export function DeployWizard() {
  const router = useRouter();
  const wizard = useDeployWizard();
  const { state } = wizard;

  const handleDeploy = async () => {
    const id = await wizard.deploy();
    if (id) {
      router.push(`/deploy/${id}`);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const stepNum = i + 1;
          const isActive = state.step === stepNum;
          const isCompleted = state.step > stepNum;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-8 bg-border" />}
              <div className="flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  isActive ? 'bg-primary text-primary-foreground' :
                  isCompleted ? 'bg-primary/20 text-primary' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {isCompleted ? '✓' : stepNum}
                </div>
                <span className={`text-sm ${isActive ? 'font-medium' : 'text-muted-foreground'}`}>
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error display */}
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {state.error}
        </div>
      )}

      {/* Step content */}
      {state.step === 1 && (
        <StepRepo
          repoUrl={state.repoUrl}
          initialCloud={state.provider ?? 'azure'}
          onUrlChange={wizard.setRepoUrl}
          onAnalyze={wizard.analyze}
          loading={state.loading}
        />
      )}

      {state.step === 2 && state.blueprint && (
        <StepBlueprint
          blueprint={state.blueprint}
          cloudProvider={state.provider ?? 'azure'}
          aiAnalysis={state.aiAnalysis}
          aiError={state.aiError}
          architectureReview={state.architectureReview}
          architectureUnitIds={state.architectureUnitIds}
          onNext={(provider) => wizard.estimate(provider)}
          loading={state.loading}
          onBack={() => wizard.setStep(1)}
        />
      )}

      {state.step === 3 && state.strategies && (
        <StepCloud
          strategies={state.strategies}
          costs={state.costs}
          onSelect={wizard.selectStrategy}
          onBack={() => wizard.setStep(2)}
        />
      )}

      {state.step === 4 && state.selectedStrategy && (
        <StepConfirm
          repoUrl={state.repoUrl}
          blueprint={state.blueprint!}
          strategy={state.selectedStrategy}
          security={state.security}
          costs={state.costs}
          live={state.live}
          onToggleLive={wizard.setLive}
          onDeploy={handleDeploy}
          onBack={() => wizard.setStep(3)}
          loading={state.loading}
        />
      )}
    </div>
  );
}

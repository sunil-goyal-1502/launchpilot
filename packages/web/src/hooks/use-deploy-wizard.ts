'use client';

import { useState, useCallback } from 'react';
import type {
  ApplicationBlueprint,
  ScalingStrategy,
  SecurityPolicy,
  CloudProvider,
  StrategyTier,
  CostBreakdown,
  BaaSMigrationChoice,
} from '@launchpilot/core';
import { analyzeRepo, estimateCosts, startDeploy } from '@/lib/api-client';

export interface WizardState {
  step: number;
  repoUrl: string;
  blueprint: ApplicationBlueprint | null;
  provider: CloudProvider | null;
  strategies: ScalingStrategy[] | null;
  selectedStrategy: ScalingStrategy | null;
  security: SecurityPolicy | null;
  costs: Record<string, CostBreakdown> | null;
  migrationChoice?: BaaSMigrationChoice;
  live: boolean;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: WizardState = {
  step: 1,
  repoUrl: '',
  blueprint: null,
  provider: null,
  strategies: null,
  selectedStrategy: null,
  security: null,
  costs: null,
  live: false,
  loading: false,
  error: null,
};

export function useDeployWizard() {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  const setStep = useCallback((step: number) => {
    setState(prev => ({ ...prev, step, error: null }));
  }, []);

  const setRepoUrl = useCallback((repoUrl: string) => {
    setState(prev => ({ ...prev, repoUrl }));
  }, []);

  const analyze = useCallback(async (repoUrl: string) => {
    setState(prev => ({ ...prev, loading: true, error: null, repoUrl }));
    try {
      const { blueprint } = await analyzeRepo({ repoUrl });
      setState(prev => ({ ...prev, blueprint, loading: false, step: 2 }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setState(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, []);

  const estimate = useCallback(async (provider: CloudProvider) => {
    if (!state.repoUrl) return;
    setState(prev => ({ ...prev, loading: true, error: null, provider }));
    try {
      const result = await estimateCosts({
        repoUrl: state.repoUrl,
        provider,
        migrationChoice: state.migrationChoice,
      });
      setState(prev => ({
        ...prev,
        strategies: result.strategies,
        security: result.security,
        costs: result.costs as Record<string, CostBreakdown>,
        loading: false,
        step: 3,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setState(prev => ({ ...prev, loading: false, error: msg }));
    }
  }, [state.repoUrl, state.migrationChoice]);

  const selectStrategy = useCallback((strategy: ScalingStrategy) => {
    setState(prev => ({ ...prev, selectedStrategy: strategy, step: 4 }));
  }, []);

  const setLive = useCallback((live: boolean) => {
    setState(prev => ({ ...prev, live }));
  }, []);

  const deploy = useCallback(async (): Promise<string | null> => {
    if (!state.provider || !state.selectedStrategy) return null;
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const { id } = await startDeploy({
        repoUrl: state.repoUrl,
        provider: state.provider,
        strategyTier: state.selectedStrategy!.tier as StrategyTier,
        migrationChoice: state.migrationChoice,
        live: state.live,
      });
      setState(prev => ({ ...prev, loading: false }));
      return id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setState(prev => ({ ...prev, loading: false, error: msg }));
      return null;
    }
  }, [state.provider, state.selectedStrategy, state.repoUrl, state.migrationChoice, state.live]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  return {
    state,
    setStep,
    setRepoUrl,
    analyze,
    estimate,
    selectStrategy,
    setLive,
    deploy,
    reset,
  };
}

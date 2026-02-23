import { PipelineContext } from '../orchestrator/context';

export abstract class BaseAgent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly description: string;

  abstract execute(input: TInput, context: PipelineContext): Promise<TOutput>;

  protected log(context: PipelineContext, message: string): void {
    context.log(this.name, message);
  }

  protected async timed<T>(
    context: PipelineContext,
    label: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    this.log(context, `Starting: ${label}`);
    const result = await fn();
    const elapsed = Date.now() - start;
    context.setTiming(this.name, label, elapsed);
    this.log(context, `Completed: ${label} (${elapsed}ms)`);
    return result;
  }
}

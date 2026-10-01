import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScriptValidation } from '../../../packages/web/src/components/infrastructure/script-validation';
import { scriptGenerationBlocker, type GenerationPrerequisites } from '../../../packages/web/src/lib/script-generation';

const ready:GenerationPrerequisites={hasPlan:true,environment:'prod',issues:[]};
const render=(prerequisites:GenerationPrerequisites)=>renderToStaticMarkup(createElement(ScriptValidation,{designId:'design',revision:1,architectureId:'snapshot',unitIds:['prod'],prerequisites,onResumeReview:async()=>{}}));
describe('script generation prerequisites',()=>{
  it('allows local generation without a cloud validation target and explains the distinction',()=>{
    expect(scriptGenerationBlocker(ready)).toBeNull();
    const html=render(ready);
    expect(html).toContain('Local script checks — no cloud target required');
    expect(html).toContain('optional for generating scripts');
    expect(html).not.toContain('disabled=');
  });
  it('surfaces the actual review failure and a resume action next to generation',()=>{
    const state:GenerationPrerequisites={...ready,hasPlan:false,reviewJob:{id:'review',designId:'design',architectureId:'snapshot',unitIds:['prod'],status:'failed',step:'Review paused',error:'Every file part must be reviewed exactly once',completedCalls:5,reusedCalls:15,attempt:4,updatedAt:''}};
    const html=render(state);
    expect(html).toContain('Architecture review needs attention');
    expect(html).toContain(state.reviewJob!.error);
    expect(html).toContain('Resume architecture review');
    expect(html).toContain('selecting a validation target will not resolve this review failure');
  });
  it('keeps design blockers and unsaved revisions gated while allowing advisory warnings',()=>{
    expect(scriptGenerationBlocker({...ready,issues:[{id:'warning',severity:'warning',message:'Provider recovery needs verification'}]})).toBeNull();
    const blocker=scriptGenerationBlocker({...ready,issues:[{id:'missing-image',severity:'blocker',message:'Supply the new workload image'}]});
    expect(blocker?.details).toEqual(['Supply the new workload image']);
    expect(blocker?.canResume).toBe(false);
    expect(scriptGenerationBlocker({...ready,saving:true})?.title).toBe('Saving architecture changes');
  });
});

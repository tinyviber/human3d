import {Switch as SwitchPrimitive} from '@base-ui/react/switch';
import type {ComponentProps} from 'react';
import {cn} from '../../lib/utils';

/** Nova-shaped switch. Renders `role="switch"` with `aria-checked`; pass
 * `aria-label` so the accessible name stays the control's own label. */
function Switch({className, ...props}:ComponentProps<typeof SwitchPrimitive.Root>){
 return <SwitchPrimitive.Root data-slot="switch" className={cn('k-switch', className)} {...props}>
  <SwitchPrimitive.Thumb data-slot="switch-thumb" className="k-switch-thumb"/>
 </SwitchPrimitive.Root>;
}

export {Switch};

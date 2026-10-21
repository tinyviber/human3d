import {Button as ButtonPrimitive} from '@base-ui/react/button';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '../../lib/utils';

/** Nova-shaped button on Base UI. Visuals live in ui.css so they sit above the
 * app's unlayered button reset; variants are the shadcn cva contract. */
const buttonVariants=cva('k-btn', {
 variants:{
  variant:{
   default:'k-btn-default',
   outline:'k-btn-outline',
   ghost:'k-btn-ghost',
  },
  size:{
   default:'k-btn-md',
   sm:'k-btn-sm',
   icon:'k-btn-icon',
  },
 },
 defaultVariants:{variant:'ghost', size:'default'},
});

function Button({className, variant, size, ...props}:ButtonPrimitive.Props & VariantProps<typeof buttonVariants>){
 return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({variant, size}), className)} {...props}/>;
}

export {Button, buttonVariants};

import {clsx, type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';

/** shadcn `cn` — class names merge through tailwind-merge so variant classes override. */
export function cn(...inputs:ClassValue[]){
 return twMerge(clsx(inputs));
}

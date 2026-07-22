/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Icons from 'lucide-react';

interface IconRendererProps {
  name: string;
  className?: string;
  size?: number;
}

export function IconRenderer({ name, className, size = 16 }: IconRendererProps) {
  // Resolve icon component dynamically from lucide-react
  const IconComponent = (Icons as any)[name];
  
  if (!IconComponent) {
    // Return a default circle indicator if not found
    return <Icons.Circle className={className} size={size} />;
  }

  return <IconComponent className={className} size={size} />;
}

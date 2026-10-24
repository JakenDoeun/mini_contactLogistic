// Messages with elements inside (Phase 13): "run {command} in the project folder" with {command} as a <code>. The
// translated sentence decides where the element goes; plain values and plurals are filled in first.
import { Fragment, type ReactNode } from 'react';

export function richParts(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <Fragment key={i}>{name && name in parts ? parts[name] : piece}</Fragment>;
  });
}

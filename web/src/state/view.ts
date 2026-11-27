export type View =
  | { kind: 'today' }
  | { kind: 'all' }
  | { kind: 'completed' }
  | { kind: 'list'; id: string }
  | { kind: 'settings' };

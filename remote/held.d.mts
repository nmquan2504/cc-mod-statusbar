// Types for held.mjs, for the plugin's tests.
export type Held = { hid: string; tool: string; input: Record<string, unknown>; suggestions: unknown[] | null; at: number }
export type HeldQuestion = { header?: string; question: string; description?: string; options?: { label: string; description?: string }[]; multiSelect?: boolean }
export type HeldDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }
export const HELD_YES: string
export const HELD_NO: string
export function allowRulesOf(list: unknown): string[]
export function suggestionText(list: unknown): string
export function heldAlways(h: Held): string
export function heldCall(input: Record<string, unknown>): string
export function heldAsk(h: Held): { id: string; questions: HeldQuestion[] }
export function heldDecision(h: Held, answers: Record<string, string>, isDismissed: boolean): HeldDecision
export function heldRules(h: Held, answers: Record<string, string>, isDismissed: boolean): string[]
export function isHeldCall(h: Held, tool: string, input: Record<string, unknown>): boolean

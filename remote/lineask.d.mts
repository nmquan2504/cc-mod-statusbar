// The types of lineask.mjs, for the plugin's tests.
export type LineAskState = { status: 'sending' | 'sent'; wasBusy: boolean; sawBusy: boolean }
export function lineAt(offsetY: number, padTop: number, lineHeight: number, count: number): number
export type Picked = { from: number; to: number }
export function pickLines(picked: Picked | null, n: number): Picked
export function linesLabel(from: number, to: number): string
export function lineAskText(mention: string, from: number, to: number, text: string, ask: string): string
export function hunkLines(header: string): Picked | null
export function hunkAskText(mention: string, hunk: string, ask: string): string
export function lineAskPhase(ask: LineAskState, isBusy: boolean): 'sending' | 'waits' | 'working' | 'done'

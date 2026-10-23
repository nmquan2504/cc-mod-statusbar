// The types of lineask.mjs, for the plugin's tests.
export type LineAskState = { status: 'sending' | 'sent'; wasBusy: boolean; sawBusy: boolean }
export function lineAt(offsetY: number, padTop: number, lineHeight: number, count: number): number
export function lineAskText(mention: string, line: number, text: string, ask: string): string
export function lineAskPhase(ask: LineAskState, isBusy: boolean): 'sending' | 'waits' | 'working' | 'done'

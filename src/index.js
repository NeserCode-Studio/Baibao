/**
 * Host (Node) half of dsh-baibao.
 *
 * M0 only needs a Loader entry: the console lives in the client bundle, and
 * the host row is what makes the web host advertise `dsh.client` in its boot
 * graph. The agent-side services land here in later milestones:
 *
 *   - BaibaoService   identity/profile, Baibao workspace and thread bootstrap
 *   - BaibaoMemory    storageDomain tables, consolidation queue, memory tools
 *   - BaibaoPush      trigger filters, scheduler/webhook sinks, inbox
 *   - BaibaoSettings  Config defaults plus the single settings source of truth
 *
 * See `.agent/plan.md` and `.agent/plan-tech/spikes.md` for the verified
 * service contracts and the M1 unknowns.
 */
export const name = 'dsh-baibao'

/** No host-side behavior yet, by design. */
export function apply() {}

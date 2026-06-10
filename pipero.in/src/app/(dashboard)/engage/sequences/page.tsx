import SequenceBuilder from '@/components/engage/SequenceBuilder'
import { getEngageSequences, getEngageTemplates } from '@/app/actions/engage'

export default async function EngageSequencesPage() {
  let sequences: Awaited<ReturnType<typeof getEngageSequences>> = []
  let templates: Awaited<ReturnType<typeof getEngageTemplates>> = []
  try {
    ;[sequences, templates] = await Promise.all([
      getEngageSequences(),
      getEngageTemplates(),
    ])
  } catch {
    // No connected org / not authenticated yet — render clean empty state.
  }
  return <SequenceBuilder initialSequences={sequences} templates={templates} />
}

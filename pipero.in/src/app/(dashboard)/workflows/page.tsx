import WorkflowList from '@/components/workflows/WorkflowList'
import { getWorkflowList } from '@/app/actions/workflows'
import type { WorkflowRecord } from '@/types/workflows'

export default async function WorkflowsPage() {
  let workflows: WorkflowRecord[] = []
  try {
    workflows = await getWorkflowList()
  } catch {
    workflows = []
  }
  return <WorkflowList initialWorkflows={workflows} />
}


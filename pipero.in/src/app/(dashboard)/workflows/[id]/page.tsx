import { notFound } from 'next/navigation'
import WorkflowBuilder from '@/components/workflows/WorkflowBuilder'
import { getWorkflowById } from '@/app/actions/workflows'

export default async function WorkflowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workflow = await getWorkflowById(id)
  if (!workflow) return notFound()
  return <WorkflowBuilder workflow={workflow} />
}


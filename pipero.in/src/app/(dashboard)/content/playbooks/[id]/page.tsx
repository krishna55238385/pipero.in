import { redirect } from 'next/navigation'

export default async function PlaybookDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  redirect(`/content?type=playbook&id=${params.id}`)
}


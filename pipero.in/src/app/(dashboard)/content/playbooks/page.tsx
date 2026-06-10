import { redirect } from 'next/navigation'

export default async function PlaybooksPage() {
  redirect('/content?type=playbook')
}


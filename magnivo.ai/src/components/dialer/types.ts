export type LeadTemperature = 'Hot' | 'Warm' | 'Cold'
export type CallStatus = 'Idle' | 'Calling' | 'Connected' | 'Ended'

export type DialerLead = {
  id: string
  name: string
  company: string
  phone: string
  status: LeadTemperature
  title: string
}


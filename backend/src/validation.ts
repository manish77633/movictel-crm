import { z } from 'zod'
export const id = z.string().regex(/^[a-f0-9]{24}$/)
export const providerId = z.string().regex(/^\d{1,32}$/)
export const statuses = [
  'New',
  'Contacted',
  'Interested',
  'Follow-up',
  'Converted',
  'Lost',
] as const
export const role = z.enum(['admin', 'client', 'agent'])
export const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase())
export const password = z.string().min(12).max(128)
export const line = z.string().trim().min(1).max(160)
export const lead = z.object({
  name: line,
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .or(z.literal(''))
    .optional(),
  email: email.or(z.literal('')).optional(),
  company: line.or(z.literal('')).optional(),
  campaign: line.or(z.literal('')).optional(),
  tags: z.array(line).max(30).optional(),
  status: z.enum(statuses).optional(),
  consent: z.enum(['unknown', 'granted', 'opted_out']).optional(),
})
export const followUp = z.object({
  leadId: id,
  description: z.string().trim().min(1).max(1000),
  dueAt: z.string().datetime({ offset: true }),
  priority: z.enum(['normal', 'high']).optional(),
})
export const template = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
  language: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  body: z.string().trim().min(1).max(1024),
})
export const automation = z.object({
  name: line,
  trigger: z.enum(['lead.imported', 'lead.status', 'followup.created']),
  action: z.enum(['template', 'assign', 'followup', 'notification']),
  formId: providerId.optional(),
  templateId: id.optional(),
  templateVariables: z
    .array(z.enum(['name', 'company', 'campaign']))
    .max(20)
    .optional(),
  assignedTo: id.optional(),
  delay: z.number().int().min(0).max(43200).optional(),
  enabled: z.boolean().optional(),
})

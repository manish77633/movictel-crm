import { Schema, model, type SchemaDefinition } from 'mongoose'

const fields = Schema.Types.Mixed
type FieldValue<T> = T extends StringConstructor
  ? string
  : T extends NumberConstructor
    ? number
    : T extends BooleanConstructor
      ? boolean
      : T extends DateConstructor
        ? Date
        : T extends { type: infer U }
          ? FieldValue<U>
          : T extends (infer U)[]
            ? FieldValue<U>[]
            : unknown
type DocumentFields<T> = { [K in keyof T]?: FieldValue<T[K]> } & {
  workspaceId: string
  createdAt: Date
  updatedAt: Date
}
function collection<T extends Record<string, unknown>>(
  name: string,
  attributes: T,
  indexes: [Record<string, 1 | -1>, Record<string, unknown>?][] = [],
  scoped = true,
) {
  const definition = {
    ...(scoped ? { workspaceId: { type: String, required: true, index: true } } : {}),
    ...attributes,
  }
  const schema = new Schema<DocumentFields<T>>(
    definition as unknown as SchemaDefinition<DocumentFields<T>>,
    { timestamps: true },
  )
  for (const [key, options] of indexes) schema.index(key, options)
  return model(name, schema)
}
export const User = collection(
  'User',
  { name: String, email: { type: String, unique: true }, password: String, verified: Boolean },
  [],
  false,
)
export const Workspace = collection(
  'Workspace',
  { name: String, timezone: String, assignmentCursor: { type: Number, default: 0 } },
  [],
  false,
)
export const Member = collection('WorkspaceMember', { userId: String, role: String }, [
  [{ workspaceId: 1, userId: 1 }, { unique: true }],
])
export const Session = collection(
  'Session',
  { userId: String, digest: { type: String, unique: true }, expiresAt: Date },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
  false,
)
export const AccountToken = collection(
  'AccountToken',
  { userId: String, digest: { type: String, unique: true }, purpose: String, expiresAt: Date },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
  false,
)
export const Lead = collection(
  'Lead',
  {
    name: String,
    phone: String,
    email: String,
    company: String,
    source: String,
    campaign: String,
    campaignSheetId: String,
    campaignSheetName: String,
    sheetFields: [{ label: String, value: String, _id: false }],
    pageId: String,
    formId: String,
    assignedTo: String,
    status: String,
    tags: [String],
    answers: fields,
    consent: String,
    consentAt: Date,
    contactedAt: Date,
    archivedAt: Date,
    externalId: String,
  },
  [
    [
      { workspaceId: 1, source: 1, externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
    ],
    [{ workspaceId: 1, archivedAt: 1, createdAt: -1 }],
    [{ workspaceId: 1, campaignSheetId: 1, archivedAt: 1, createdAt: -1 }],
    [{ workspaceId: 1, assignedTo: 1, status: 1 }],
    [{ workspaceId: 1, phone: 1, consent: 1 }],
  ],
)
export const Note = collection('LeadNote', { leadId: String, authorId: String, text: String }, [
  [{ workspaceId: 1, leadId: 1, createdAt: -1 }],
])
export const Activity = collection(
  'ActivityLog',
  { leadId: String, actorId: String, kind: String, detail: String, eventKey: String },
  [
    [
      { workspaceId: 1, eventKey: 1 },
      { unique: true, partialFilterExpression: { eventKey: { $type: 'string' } } },
    ],
  ],
)
export const FollowUp = collection(
  'FollowUp',
  {
    leadId: String,
    assignedTo: String,
    dueAt: Date,
    description: String,
    priority: String,
    status: String,
    eventKey: String,
    notifiedAt: Date,
  },
  [
    [{ status: 1, dueAt: 1 }],
    [
      { workspaceId: 1, eventKey: 1 },
      { unique: true, partialFilterExpression: { eventKey: { $type: 'string' } } },
    ],
  ],
)
export const Integration = collection(
  'Integration',
  {
    provider: String,
    accountId: String,
    phoneId: String,
    label: String,
    credential: { type: String, select: false },
    expiresAt: Date,
    lastSyncAt: Date,
  },
  [
    [{ workspaceId: 1, provider: 1 }, { unique: true }],
    [
      { provider: 1, phoneId: 1 },
      { unique: true, partialFilterExpression: { phoneId: { $type: 'string' } } },
    ],
  ],
)
export const SheetConnection = collection('SheetConnection', {
  workspaceId: { type: String, required: true, index: true },
  spreadsheetId: { type: String, required: true, unique: true },
  sheetId: { type: Number, required: true },
  tabName: String,
  campaignName: String,
  legacyIds: Boolean,
  lastAttemptAt: Date,
  lastSyncAt: Date,
  lastImported: Number,
  skipped: Number,
  error: String,
  leaseUntil: Date,
})
SheetConnection.schema.set('autoIndex', false)
export const FacebookPage = collection(
  'FacebookPage',
  { externalId: String, name: String, credential: { type: String, select: false } },
  [[{ workspaceId: 1, externalId: 1 }, { unique: true }]],
)
export const FacebookForm = collection(
  'FacebookForm',
  { externalId: String, pageId: String, name: String, selected: Boolean },
  [
    [
      { pageId: 1, externalId: 1 },
      { unique: true, partialFilterExpression: { selected: true } },
    ],
    [{ workspaceId: 1, pageId: 1, externalId: 1 }, { unique: true }],
  ],
)
export const WebhookEvent = collection(
  'WebhookEvent',
  { provider: String, eventKey: String, payload: fields, status: String },
  [[{ provider: 1, eventKey: 1 }, { unique: true }], [{ status: 1, createdAt: 1 }]],
)
export const Conversation = collection(
  'Conversation',
  {
    leadId: String,
    phone: String,
    status: String,
    unread: Number,
    lastInboundAt: Date,
    lastInboundPhoneId: String,
    lastMessage: String,
  },
  [[{ workspaceId: 1, phone: 1 }, { unique: true }]],
)
export const Message = collection(
  'Message',
  {
    conversationId: String,
    direction: String,
    text: String,
    type: String,
    mediaId: String,
    status: String,
    externalId: String,
    providerTimestamp: Date,
    templateId: String,
    variables: [String],
    requestId: String,
    mediaUrl: String,
    automationExecution: String,
    providerPhoneId: String,
    startedAt: Date,
  },
  [
    [
      { workspaceId: 1, conversationId: 1, requestId: 1 },
      { unique: true, partialFilterExpression: { requestId: { $type: 'string' } } },
    ],
    [{ status: 1, createdAt: 1 }],
    [
      { workspaceId: 1, externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
    ],
    [{ workspaceId: 1, conversationId: 1, createdAt: 1 }],
  ],
)
export const Template = collection(
  'MessageTemplate',
  {
    name: String,
    category: String,
    language: String,
    body: String,
    status: String,
    externalId: String,
    components: fields,
  },
  [[{ workspaceId: 1, name: 1, language: 1 }, { unique: true }]],
)
export const Automation = collection('Automation', {
  name: String,
  trigger: String,
  action: String,
  formId: String,
  templateId: String,
  templateVariables: [String],
  assignedTo: String,
  delay: Number,
  enabled: Boolean,
})
export const Execution = collection(
  'AutomationExecution',
  { automationId: String, leadId: String, eventKey: String, dueAt: Date, status: String },
  [[{ workspaceId: 1, automationId: 1, eventKey: 1 }, { unique: true }], [{ status: 1, dueAt: 1 }]],
)
export const Notification = collection(
  'Notification',
  { userId: String, leadId: String, text: String, read: Boolean, eventKey: String },
  [
    [
      { workspaceId: 1, eventKey: 1 },
      { unique: true, partialFilterExpression: { eventKey: { $type: 'string' } } },
    ],
  ],
)
export const Invitation = collection(
  'Invitation',
  { email: String, role: String, digest: String, expiresAt: Date },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
)
export const models = [
  User,
  Workspace,
  Member,
  Session,
  AccountToken,
  Lead,
  Note,
  Activity,
  FollowUp,
  Integration,
  SheetConnection,
  FacebookPage,
  FacebookForm,
  WebhookEvent,
  Conversation,
  Message,
  Template,
  Automation,
  Execution,
  Notification,
  Invitation,
]

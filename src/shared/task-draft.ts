export interface DraftTurn { role: 'user' | 'assistant'; text: string }
export interface TaskDraftReply {
  reply: string;
  ready: boolean;
  specTitle: string;
  specDescription: string;
}

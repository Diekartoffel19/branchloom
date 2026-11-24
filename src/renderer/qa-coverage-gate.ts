/** Ignore UI responses started for a project that is no longer selected. */
export class QaCoverageProjectGate {
  private projectId: string;
  private generation = 0;

  constructor(projectId: string) { this.projectId = projectId; }

  enter(projectId: string): void {
    if (projectId === this.projectId) return;
    this.projectId = projectId;
    this.generation++;
  }

  ticket(): { projectId: string; generation: number } { return { projectId: this.projectId, generation: this.generation }; }

  begin(): { projectId: string; generation: number } { this.generation++; return this.ticket(); }

  isCurrent(ticket: { projectId: string; generation: number }): boolean {
    return ticket.projectId === this.projectId && ticket.generation === this.generation;
  }
}

import { useEffect, useRef, useState } from 'react';
import type { ProjectMilestone } from '../../shared/milestones';

export interface MilestoneImagePair {
  before: { milestone: ProjectMilestone; image: string };
  after: { milestone: ProjectMilestone; image: string };
}

export async function loadMilestoneImagePair(
  projectId: string,
  milestones: ProjectMilestone[],
  beforeId: string,
  afterId: string,
  getImage: (input: { projectId: string; milestoneId: string }) => Promise<string>,
): Promise<MilestoneImagePair> {
  if (!beforeId || !afterId || beforeId === afterId) throw new Error('Wähle zwei verschiedene Meilensteine mit gespeicherten Bildern.');
  const before = milestones.find((item) => item.id === beforeId);
  const after = milestones.find((item) => item.id === afterId);
  if (!before || !after || !before.previewAvailable || !after.previewAvailable || before.projectId !== projectId || after.projectId !== projectId) {
    throw new Error('Die gewählten Vorschauaufnahmen gehören nicht zu diesem Projekt oder sind nicht mehr verfügbar.');
  }
  const [beforeImage, afterImage] = await Promise.all([
    getImage({ projectId, milestoneId: before.id }),
    getImage({ projectId, milestoneId: after.id }),
  ]);
  if (![beforeImage, afterImage].every((image) => /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image))) {
    throw new Error('Eine gespeicherte Vorschauaufnahme konnte nicht als PNG geladen werden.');
  }
  return { before: { milestone: before, image: beforeImage }, after: { milestone: after, image: afterImage } };
}

function optionText(item: ProjectMilestone): string {
  return `${item.label} · ${new Date(item.createdAt).toLocaleString()} · ${item.commit.slice(0, 12)}`;
}

export function MilestoneImagePairView({ pair, onImageError }: { pair: MilestoneImagePair; onImageError: () => void }) {
  return <div className="milestones-image-compare-grid" aria-label="Bildvergleich">
    {([pair.before, pair.after] as const).map((entry, index) => <figure key={entry.milestone.id}>
      <figcaption><strong>{index === 0 ? 'Vorher' : 'Nachher'} · {entry.milestone.label}</strong><span>{new Date(entry.milestone.previewCapturedAt ?? entry.milestone.createdAt).toLocaleString()} · {entry.milestone.commit.slice(0, 12)}</span><span>{entry.milestone.previewSource}</span></figcaption>
      <img src={entry.image} alt={`${index === 0 ? 'Vorher' : 'Nachher'}: lokale Vorschauaufnahme ${entry.milestone.label}`} onError={onImageError} />
    </figure>)}
  </div>;
}

export function MilestoneImageCompare({ projectId, milestones }: { projectId: string; milestones: ProjectMilestone[] }) {
  const available = milestones.filter((item) => item.projectId === projectId && item.previewAvailable);
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');
  const [pair, setPair] = useState<MilestoneImagePair | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  useEffect(() => {
    request.current += 1;
    setBeforeId(''); setAfterId(''); setPair(null); setBusy(false); setError('');
    return () => { request.current += 1; };
  }, [projectId]);

  function changeBefore(id: string) { request.current += 1; setBeforeId(id); setPair(null); setBusy(false); setError(''); }
  function changeAfter(id: string) { request.current += 1; setAfterId(id); setPair(null); setBusy(false); setError(''); }

  async function compare() {
    const current = ++request.current;
    setPair(null); setError(''); setBusy(true);
    try {
      const loaded = await loadMilestoneImagePair(projectId, milestones, beforeId, afterId, (input) => window.studio.milestonePreviewImage(input));
      if (current === request.current) setPair(loaded);
    } catch (reason) {
      if (current === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  return <section className="milestones-image-compare" aria-labelledby="milestones-image-compare-heading">
    <h3 id="milestones-image-compare-heading">Zwei Aufnahmen vergleichen</h3>
    <p>Wähle zwei gespeicherte Bilder dieses Projekts. Sie werden erst mit „Bilder vergleichen“ geladen. Die Aufnahmen zeigen lokale Serverzustände; sie beweisen nicht, welcher Git-Commit ausgeliefert wurde.</p>
    {available.length < 2 ? <p className="milestones-empty" role="status">Für einen Bildvergleich brauchst du zwei Meilensteine mit Vorschauaufnahme. Bisher verfügbar: {available.length}.</p> : <>
      <div className="milestones-image-compare-controls">
        <label>Vorher<select value={beforeId} onChange={(event) => changeBefore(event.target.value)}><option value="">Aufnahme wählen</option>{available.map((item) => <option key={item.id} value={item.id}>{optionText(item)}</option>)}</select></label>
        <label>Nachher<select value={afterId} onChange={(event) => changeAfter(event.target.value)}><option value="">Aufnahme wählen</option>{available.map((item) => <option key={item.id} value={item.id}>{optionText(item)}</option>)}</select></label>
        <button type="button" className="secondary-button" disabled={busy || !beforeId || !afterId || beforeId === afterId} onClick={() => void compare()}>{busy ? 'Bilder laden…' : 'Bilder vergleichen'}</button>
      </div>
      {beforeId && beforeId === afterId ? <p className="milestones-condition" role="status">Wähle für „Nachher“ eine andere Aufnahme.</p> : null}
      {error ? <p className="milestones-feedback error" role="alert">{error}</p> : null}
      {pair ? <MilestoneImagePairView pair={pair} onImageError={() => { setPair(null); setError('Eine gespeicherte Vorschauaufnahme konnte nicht angezeigt werden.'); }} /> : null}
    </>}
  </section>;
}

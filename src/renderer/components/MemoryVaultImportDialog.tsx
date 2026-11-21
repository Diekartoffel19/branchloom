import type { MemoryVaultImportPreview } from '../../shared/types';

export function MemoryVaultImportDialog({ preview, selected, busy, onToggle, onAll, onClose, onImport }: {
  preview: MemoryVaultImportPreview;
  selected: ReadonlySet<string>;
  busy: boolean;
  onToggle: (key: string) => void;
  onAll: (all: boolean) => void;
  onClose: () => void;
  onImport: () => void;
}) {
  const rejected = preview.files.length - preview.eligible;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section className="dialog memory-vault-dialog" role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title">
      <div className="dialog-heading"><div><small>MARKDOWN-VAULT</small><h2 id="vault-dialog-title">Import prüfen</h2></div><button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Schließen">×</button></div>
      <p className="field-help">Ordner: {preview.directoryName} · {preview.eligible} neue Notizen · {rejected} ausgelassen</p>
      <p className="field-help">Nur ausgewählte neue Notizen werden lokal gespeichert. Vorhandene Titel werden nicht überschrieben. Es gibt keinen automatischen Abgleich.</p>
      <div className="memory-vault-selection"><button type="button" className="text-button" disabled={busy || !preview.eligible} onClick={() => onAll(true)}>Alle neuen wählen</button><button type="button" className="text-button" disabled={busy || !selected.size} onClick={() => onAll(false)}>Auswahl leeren</button></div>
      <div className="memory-vault-files" role="group" aria-label="Markdown-Dateien auswählen">
        {preview.files.length ? preview.files.map((file) => <label className="memory-vault-file" key={file.key}>
          <input type="checkbox" disabled={busy || !file.eligible} checked={selected.has(file.key)} onChange={() => onToggle(file.key)} />
          <span><strong>{file.title}</strong><small>{file.key}</small>{file.reason ? <small className="memory-vault-reason">{file.reason}</small> : null}</span>
        </label>) : <p>Keine Markdown-Dateien in diesem Ordner gefunden.</p>}
      </div>
      <div className="dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>Abbrechen</button><button className="primary-button" type="button" disabled={busy || selected.size === 0} onClick={onImport}>{busy ? 'Import läuft…' : `${selected.size} Notizen importieren`}</button></div>
    </section>
  </div>;
}

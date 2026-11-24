import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReviewCommentHistory } from '../../src/renderer/components/ReviewDiffPanel';
import type { ReviewComment } from '../../src/shared/diff-review';

const saved: ReviewComment = {
  id: 'saved-comment', cardId: 'card', fingerprint: 'f'.repeat(64), filePath: 'src/synthetic.ts',
  side: 'new', line: 14, body: 'Prüfe <script> den alten Fehler.', createdAt: '2026-01-01T10:00:00.000Z',
};

describe('review inbox source history', () => {
  it('keeps a saved comment readable without a diff preview and opens the requested source', () => {
    const html = renderToStaticMarkup(createElement(ReviewCommentHistory, {
      comments: [saved], focusCommentId: saved.id, previewAvailable: false,
    }));
    expect(html).toContain('gespeicherten Review-Historie');
    expect(html).toContain('id="review-comment-saved-comment"');
    expect(html).toContain('open=""');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Als Projektregel übernehmen');
  });
});

import { useCallback, useState } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useProjectContext } from '@/shared/context/project-context'
import { postJSON } from '@/infrastructure/fetch-json'
import RangesTracker from '@overleaf/ranges-tracker'
import {
  runFullReview,
  deleteAiTutorComments,
  WholeProjectMetadata,
  ReviewResult,
  ReviewComment,
} from '@/features/editor-left-menu/utils/ai-tutor-service'
import { ThreadId } from '../../../../../../types/review-panel/review-panel'
import { CommentOperation } from '../../../../../../types/change'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import MaterialIcon from '@/shared/components/material-icon'

const MODEL_OPTIONS = [
  { value: 'gpt-4o', label: 'GPT-4o (Best quality)' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Faster, cheaper)' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
]

export default function AiTutorPanel() {
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Model selection
  const [selectedModel, setSelectedModel] = useState('gpt-4o')

  // Delete comments state
  const [isDeleting, setIsDeleting] = useState(false)

  // Full review state
  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [reviewProgress, setReviewProgress] = useState<string | null>(null)
  const [appliedCount, setAppliedCount] = useState(0)

  const { currentDocument } = useEditorOpenDocContext()
  const { projectId } = useProjectContext()

  // -----------------------------------------------------------------------
  // Run full review (analyzes project + runs multi-agent review in one call)
  // -----------------------------------------------------------------------
  const handleFullReview = useCallback(async () => {
    setIsReviewing(true)
    setError(null)
    setSuccessMessage(null)
    setReviewProgress(
      'Analyzing project structure and running multi-agent review... This may take 1-2 minutes.'
    )
    setReviewResult(null)
    setAppliedCount(0)

    try {
      const result = await runFullReview(projectId, selectedModel)

      if (!result.success) {
        setError(result.error || 'Review failed.')
        setIsReviewing(false)
        setReviewProgress(null)
        return
      }

      setReviewResult(result.result!)
      setReviewProgress(null)

      const r = result.result!
      const failedNote =
        r.failedAgents.length > 0
          ? ` (${r.failedAgents.length} agent(s) skipped)`
          : ''
      setSuccessMessage(
        `Review complete! ${r.summary.total} comments from ${Object.keys(r.summary.byCategory).length} reviewers.` +
          ` Paper type: ${r.classification.paperType}.${failedNote}`
      )
    } catch (err) {
      console.error('[AI Tutor] Full review error:', err)
      setError(
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      )
      setReviewProgress(null)
    } finally {
      setIsReviewing(false)
    }
  }, [projectId, selectedModel])

  // -----------------------------------------------------------------------
  // Apply review comments to currently open document
  // -----------------------------------------------------------------------
  const handleApplyComments = useCallback(async () => {
    if (!reviewResult || !currentDocument) {
      setError('No review results or no document open.')
      return
    }

    setError(null)
    setSuccessMessage(null)

    const snapshot = currentDocument.getSnapshot()
    if (!snapshot) {
      setError('Cannot read current document content.')
      return
    }

    // Collect ALL comments from every doc group and try to match them
    // against the currently open document via text search
    const allComments = Object.values(
      reviewResult.commentsByDoc
    ).flat() as ReviewComment[]

    let applied = 0
    let skipped = 0

    for (const comment of allComments) {
      // Search for the highlightText in the current document snapshot
      const idx = snapshot.indexOf(comment.highlightText)
      if (idx === -1) {
        skipped++
        continue
      }

      try {
        const threadId = RangesTracker.generateId() as ThreadId

        await postJSON(`/project/${projectId}/thread/${threadId}/messages`, {
          body: { content: comment.comment },
        })

        const op: CommentOperation = {
          c: comment.highlightText,
          p: idx,
          t: threadId,
        }

        currentDocument.submitOp(op)
        applied++
      } catch (err) {
        console.warn('[AI Tutor] Failed to apply comment:', err)
        skipped++
      }
    }

    setAppliedCount(applied)
    setSuccessMessage(
      `Applied ${applied} comment(s) to current document.` +
        (skipped > 0
          ? ` ${skipped} comment(s) didn't match this document (they belong to other files).`
          : '')
    )
  }, [reviewResult, currentDocument, projectId])

  // -----------------------------------------------------------------------
  // Delete all AI Tutor comments
  // -----------------------------------------------------------------------
  const handleDeleteComments = useCallback(async () => {
    setIsDeleting(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const result = await deleteAiTutorComments(projectId)
      if (result.deleted > 0) {
        setSuccessMessage(
          `Deleted ${result.deleted} AI Tutor comment(s). Refresh the page to see changes.`
        )
      } else {
        setSuccessMessage('No AI Tutor comments found to delete.')
      }
    } catch (err) {
      console.error('[AI Tutor] Delete comments error:', err)
      setError(
        err instanceof Error ? err.message : 'Failed to delete comments.'
      )
    } finally {
      setIsDeleting(false)
    }
  }, [projectId])

  // Helper to extract metadata from review result
  const projectMetadata: WholeProjectMetadata | undefined =
    reviewResult?.metadata

  return (
    <div className="ai-tutor-panel">
      <RailPanelHeader title="AI Tutor" />
      <div style={{ padding: '12px 16px' }}>
        {/* ── Delete AI Tutor Comments ── */}
        <OLButton
          variant="danger"
          size="sm"
          onClick={handleDeleteComments}
          disabled={isDeleting || isReviewing}
          style={{ width: '100%', marginBottom: '12px' }}
        >
          {isDeleting ? 'Deleting...' : 'Delete All AI Tutor Comments'}
        </OLButton>

        {/* ── Model Selection ── */}
        <OLFormGroup controlId="ai-tutor-model" style={{ marginBottom: '12px' }}>
          <OLFormLabel>Model</OLFormLabel>
          <OLFormControl
            as="select"
            value={selectedModel}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedModel(e.target.value)
            }
            disabled={isReviewing}
          >
            {MODEL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </OLFormControl>
        </OLFormGroup>

        {/* ── Full Paper Review ── */}
        <div
          style={{
            marginBottom: '16px',
            padding: '12px',
            backgroundColor: '#f8f9fa',
            borderRadius: '6px',
            border: '1px solid #dee2e6',
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <MaterialIcon type="rate_review" />
            <strong>Full Paper Review</strong>
          </span>
          <p
            style={{ fontSize: '13px', color: '#333', margin: '0 0 8px 0' }}
          >
            Analyzes your project structure, classifies your paper type, then
            runs parallel reviewers for each section and aspect.
          </p>

          {/* Run Full Review button */}
          <OLButton
            variant="primary"
            onClick={handleFullReview}
            disabled={isReviewing}
            style={{ width: '100%', marginBottom: '6px' }}
          >
            {isReviewing ? 'Reviewing paper...' : 'Run Full Review'}
          </OLButton>

          {reviewProgress && (
            <div
              style={{
                fontSize: '12px',
                color: '#0d6efd',
                padding: '6px 8px',
                backgroundColor: '#e7f1ff',
                borderRadius: '4px',
                marginBottom: '6px',
              }}
            >
              {reviewProgress}
            </div>
          )}

          {/* Apply comments */}
          {reviewResult && (
            <>
              <OLButton
                variant="success"
                onClick={handleApplyComments}
                disabled={!currentDocument}
                style={{ width: '100%', marginBottom: '6px' }}
              >
                Apply {reviewResult.summary.total} Comments to Current Document
              </OLButton>
              {appliedCount > 0 && (
                <p
                  style={{
                    fontSize: '12px',
                    color: '#198754',
                    margin: '0 0 6px 0',
                  }}
                >
                  {appliedCount} comment(s) applied. Switch to another file and
                  click again to apply remaining comments.
                </p>
              )}
            </>
          )}

          {/* Review summary */}
          {reviewResult && (
            <div style={{ marginTop: '4px', fontSize: '12px' }}>
              <details>
                <summary style={{ cursor: 'pointer', color: '#222' }}>
                  Review summary ({reviewResult.summary.total} comments)
                </summary>
                <div style={{ padding: '6px 0' }}>
                  <p style={{ margin: '0 0 4px 0' }}>
                    <strong>Paper type:</strong>{' '}
                    {reviewResult.classification.paperType} —{' '}
                    {reviewResult.classification.paperTypeSummary}
                  </p>
                  <p style={{ margin: '0 0 4px 0' }}>
                    <strong>By category:</strong>
                  </p>
                  <ul
                    style={{
                      margin: '2px 0 6px 0',
                      paddingLeft: '18px',
                    }}
                  >
                    {Object.entries(reviewResult.summary.byCategory).map(
                      ([cat, count]) => (
                        <li key={cat}>
                          {cat}: {count as number}
                        </li>
                      )
                    )}
                  </ul>
                  <p style={{ margin: '0 0 4px 0' }}>
                    <strong>By severity:</strong>
                  </p>
                  <ul
                    style={{
                      margin: '2px 0 6px 0',
                      paddingLeft: '18px',
                    }}
                  >
                    {Object.entries(reviewResult.summary.bySeverity).map(
                      ([sev, count]) => (
                        <li key={sev}>
                          {sev}: {count as number}
                        </li>
                      )
                    )}
                  </ul>
                  <p style={{ margin: '0 0 4px 0' }}>
                    <strong>Comments by document:</strong>
                  </p>
                  <ul
                    style={{
                      margin: '2px 0 6px 0',
                      paddingLeft: '18px',
                    }}
                  >
                    {Object.entries(reviewResult.commentsByDoc).map(
                      ([docPath, comments]) => (
                        <li key={docPath}>
                          {docPath}: {(comments as ReviewComment[]).length}
                        </li>
                      )
                    )}
                  </ul>
                  {reviewResult.failedAgents.length > 0 && (
                    <>
                      <p
                        style={{
                          margin: '0 0 4px 0',
                          color: '#dc3545',
                        }}
                      >
                        <strong>Skipped agents:</strong>
                      </p>
                      <ul
                        style={{
                          margin: '2px 0 6px 0',
                          paddingLeft: '18px',
                        }}
                      >
                        {reviewResult.failedAgents.map(
                          (a: { id: string; name: string; reason: string }) => (
                            <li key={a.id}>
                              {a.name}: {a.reason}
                            </li>
                          )
                        )}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            </div>
          )}

          {/* File details from analysis metadata */}
          {projectMetadata && (
            <div style={{ marginTop: '4px', fontSize: '12px' }}>
              <details>
                <summary style={{ cursor: 'pointer', color: '#222' }}>
                  File details ({projectMetadata.categories.texFiles.count} TeX,{' '}
                  {projectMetadata.categories.figures.count} figures,{' '}
                  {projectMetadata.mergedTexLength.toLocaleString()} chars
                  merged)
                </summary>
                <div style={{ padding: '4px 0' }}>
                  <strong>TeX files (merged):</strong>
                  <ul style={{ margin: '2px 0 6px 0', paddingLeft: '18px' }}>
                    {projectMetadata.categories.texFiles.files.map(
                      (f: string) => (
                        <li key={f}>{f}</li>
                      )
                    )}
                  </ul>
                  {projectMetadata.categories.figures.count > 0 && (
                    <>
                      <strong>Figures:</strong>
                      <ul
                        style={{
                          margin: '2px 0 6px 0',
                          paddingLeft: '18px',
                        }}
                      >
                        {projectMetadata.categories.figures.files.map(
                          (f: string) => (
                            <li key={f}>{f}</li>
                          )
                        )}
                      </ul>
                    </>
                  )}
                  {projectMetadata.categories.bibFiles.count > 0 && (
                    <>
                      <strong>Bib files:</strong>
                      <ul
                        style={{
                          margin: '2px 0 6px 0',
                          paddingLeft: '18px',
                        }}
                      >
                        {projectMetadata.categories.bibFiles.files.map(
                          (f: string) => (
                            <li key={f}>{f}</li>
                          )
                        )}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>

        {/* ── Status messages ── */}
        {error && (
          <div
            className="alert alert-danger"
            role="alert"
            style={{ marginTop: '12px', fontSize: '13px' }}
          >
            {error}
          </div>
        )}

        {successMessage && (
          <div
            className="alert alert-success"
            role="alert"
            style={{ marginTop: '12px', fontSize: '13px' }}
          >
            {successMessage}
          </div>
        )}
      </div>
    </div>
  )
}

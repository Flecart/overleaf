import { useCallback, useState } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useProjectContext } from '@/shared/context/project-context'
import { postJSON } from '@/infrastructure/fetch-json'
import RangesTracker from '@overleaf/ranges-tracker'
import {
  extractAbstract,
  analyzeAbstractWithOpenAI,
} from '@/features/editor-left-menu/utils/ai-tutor-service'
import { ThreadId } from '../../../../../../types/review-panel/review-panel'
import { CommentOperation } from '../../../../../../types/change'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import MaterialIcon from '@/shared/components/material-icon'

export default function AiTutorPanel() {
  const [apiKey, setApiKey] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { currentDocument } = useEditorOpenDocContext()
  const { projectId } = useProjectContext()

  const handleAnalyze = useCallback(async () => {
    if (!apiKey.trim()) return

    if (!currentDocument) {
      setError('No document is currently open. Please open a document first.')
      return
    }

    setIsLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const documentContent = currentDocument.getSnapshot()

      // Debug: log what we got
      console.log('[AI Tutor] Document content length:', documentContent?.length)
      console.log('[AI Tutor] Document content preview:', documentContent?.substring(0, 200))

      if (!documentContent) {
        setError('Unable to read document content. Make sure you have the main .tex file open in the editor.')
        setIsLoading(false)
        return
      }

      const abstractData = extractAbstract(documentContent)
      if (!abstractData) {
        setError(
          'No abstract found in the currently open file. Please open the main .tex file that contains \\begin{abstract}...\\end{abstract} and try again.'
        )
        setIsLoading(false)
        return
      }

      console.log('[AI Tutor] Abstract found, calling OpenAI...')

      const result = await analyzeAbstractWithOpenAI(
        apiKey.trim(),
        abstractData.content,
        abstractData.startPos
      )

      console.log('[AI Tutor] OpenAI result:', JSON.stringify(result, null, 2))

      if (!result.success) {
        setError(result.error || 'Failed to analyze abstract.')
        setIsLoading(false)
        return
      }

      console.log('[AI Tutor] Adding', result.comments.length, 'comments...')

      for (const comment of result.comments) {
        const threadId = RangesTracker.generateId() as ThreadId

        console.log('[AI Tutor] Creating thread', threadId, 'for:', comment.text.substring(0, 50))

        try {
          await postJSON(`/project/${projectId}/thread/${threadId}/messages`, {
            body: { content: comment.comment },
          })
          console.log('[AI Tutor] Thread created successfully')
        } catch (threadErr) {
          console.error('[AI Tutor] Failed to create thread:', threadErr)
          throw threadErr
        }

        const op: CommentOperation = {
          c: comment.text,
          p: comment.startOffset,
          t: threadId,
        }

        currentDocument.submitOp(op)
      }

      setSuccessMessage(
        `Added ${result.comments.length} comment${result.comments.length !== 1 ? 's' : ''} to your abstract.`
      )
      setError(null)
    } catch (err) {
      console.error('[AI Tutor] Error:', err)
      setError(
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      )
    } finally {
      setIsLoading(false)
    }
  }, [apiKey, currentDocument, projectId])

  return (
    <div className="ai-tutor-panel">
      <RailPanelHeader title="AI Tutor" />
      <div style={{ padding: '12px 16px' }}>
        <div style={{ marginBottom: '16px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <MaterialIcon type="smart_toy" />
            <strong>Writing Feedback</strong>
          </span>
          <p style={{ fontSize: '13px', color: '#6c757d', margin: 0 }}>
            Analyze your abstract with AI and get writing suggestions as inline
            comments.
          </p>
        </div>

        <OLFormGroup controlId="ai-tutor-api-key">
          <OLFormLabel>OpenAI API Key</OLFormLabel>
          <OLFormControl
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setApiKey(e.target.value)
            }
            disabled={isLoading}
            required
          />
          <small style={{ color: '#6c757d' }}>
            Your key is only used for this session and is not stored.
          </small>
        </OLFormGroup>

        <OLButton
          variant="primary"
          onClick={handleAnalyze}
          disabled={!apiKey.trim() || isLoading}
          style={{ width: '100%', marginTop: '12px' }}
        >
          {isLoading ? 'Analyzing...' : 'Analyze Abstract'}
        </OLButton>

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

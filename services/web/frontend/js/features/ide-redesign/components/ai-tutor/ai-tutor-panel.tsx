import { useCallback, useState } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useProjectContext } from '@/shared/context/project-context'
import { postJSON } from '@/infrastructure/fetch-json'
import RangesTracker from '@overleaf/ranges-tracker'
import {
  extractAbstract,
  analyzeAbstractWithOpenAI,
  analyzeWholeProject,
  WholeProjectMetadata,
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

  // Whole project analysis state
  const [isAnalyzingProject, setIsAnalyzingProject] = useState(false)
  const [projectMetadata, setProjectMetadata] =
    useState<WholeProjectMetadata | null>(null)
  const [analysisInfo, setAnalysisInfo] = useState<string | null>(null)

  const { currentDocument } = useEditorOpenDocContext()
  const { projectId } = useProjectContext()

  const handleWholeProjectAnalysis = useCallback(async () => {
    setIsAnalyzingProject(true)
    setError(null)
    setSuccessMessage(null)
    setAnalysisInfo(null)

    try {
      const result = await analyzeWholeProject(projectId)

      if (!result.success) {
        setError(result.error || 'Failed to analyze project.')
        setIsAnalyzingProject(false)
        return
      }

      setProjectMetadata(result.metadata!)

      const meta = result.metadata!
      const infoLines = [
        `Root: ${meta.rootDocPath}`,
        `TeX files: ${meta.categories.texFiles.count}`,
        `Figures: ${meta.categories.figures.count}`,
        `Bib files: ${meta.categories.bibFiles.count}`,
        `Other useful: ${meta.categories.usefulFiles.count}`,
        `Unused: ${meta.categories.irrelevantFiles.count}`,
        `Merged length: ${meta.mergedTexLength.toLocaleString()} chars`,
      ]
      setAnalysisInfo(infoLines.join(' | '))
      setSuccessMessage(
        `Project analyzed! Found ${meta.categories.texFiles.count} TeX file(s) ` +
          `merged into ${meta.mergedTexLength.toLocaleString()} characters. ` +
          `Ready for whole-paper writing suggestions.`
      )
    } catch (err) {
      console.error('[AI Tutor] Whole project analysis error:', err)
      setError(
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      )
    } finally {
      setIsAnalyzingProject(false)
    }
  }, [projectId])

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

      if (!documentContent) {
        setError(
          'Unable to read document content. Make sure you have the main .tex file open in the editor.'
        )
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

      const result = await analyzeAbstractWithOpenAI(
        apiKey.trim(),
        abstractData.content,
        abstractData.startPos
      )

      if (!result.success) {
        setError(result.error || 'Failed to analyze abstract.')
        setIsLoading(false)
        return
      }

      // Optional: Send analytics/logging to server
      try {
        await postJSON(`/project/${projectId}/ai-tutor-log`, {
          body: {
            timestamp: new Date().toISOString(),
            abstract: abstractData.content,
            suggestions: result.comments,
            model: 'gpt-4o',
          },
        })
      } catch (logErr) {
        console.warn('[AI Tutor] Failed to log suggestions:', logErr)
      }

      for (const comment of result.comments) {
        const threadId = RangesTracker.generateId() as ThreadId

        await postJSON(`/project/${projectId}/thread/${threadId}/messages`, {
          body: { content: comment.comment },
        })

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
        {/* Whole Project Analysis Section */}
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
            <MaterialIcon type="description" />
            <strong>Whole Paper Analysis</strong>
          </span>
          <p
            style={{ fontSize: '13px', color: '#6c757d', margin: '0 0 8px 0' }}
          >
            Analyze your entire project structure. Merges all .tex files in
            reading order and categorizes project files.
          </p>
          <OLButton
            variant="secondary"
            onClick={handleWholeProjectAnalysis}
            disabled={isAnalyzingProject}
            style={{ width: '100%' }}
          >
            {isAnalyzingProject
              ? 'Analyzing project...'
              : 'Give Writing Suggestions'}
          </OLButton>

          {analysisInfo && (
            <div
              style={{
                marginTop: '8px',
                fontSize: '12px',
                color: '#495057',
                padding: '8px',
                backgroundColor: '#e9ecef',
                borderRadius: '4px',
                wordBreak: 'break-word',
              }}
            >
              {analysisInfo}
            </div>
          )}

          {projectMetadata && (
            <div style={{ marginTop: '8px', fontSize: '12px' }}>
              <details>
                <summary style={{ cursor: 'pointer', color: '#495057' }}>
                  File details
                </summary>
                <div style={{ padding: '4px 0' }}>
                  <strong>TeX files (merged):</strong>
                  <ul style={{ margin: '2px 0 6px 0', paddingLeft: '18px' }}>
                    {projectMetadata.categories.texFiles.files.map((f: string) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  {projectMetadata.categories.figures.count > 0 && (
                    <>
                      <strong>Figures:</strong>
                      <ul
                        style={{ margin: '2px 0 6px 0', paddingLeft: '18px' }}
                      >
                        {projectMetadata.categories.figures.files.map((f: string) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {projectMetadata.categories.bibFiles.count > 0 && (
                    <>
                      <strong>Bib files:</strong>
                      <ul
                        style={{ margin: '2px 0 6px 0', paddingLeft: '18px' }}
                      >
                        {projectMetadata.categories.bibFiles.files.map((f: string) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {projectMetadata.categories.usefulFiles.count > 0 && (
                    <>
                      <strong>Style/class files:</strong>
                      <ul
                        style={{ margin: '2px 0 6px 0', paddingLeft: '18px' }}
                      >
                        {projectMetadata.categories.usefulFiles.files.map(
                          (f: string) => (
                            <li key={f}>{f}</li>
                          )
                        )}
                      </ul>
                    </>
                  )}
                  {projectMetadata.categories.irrelevantFiles.count > 0 && (
                    <>
                      <strong>Unused files:</strong>
                      <ul
                        style={{ margin: '2px 0 6px 0', paddingLeft: '18px' }}
                      >
                        {projectMetadata.categories.irrelevantFiles.files.map(
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

        {/* Abstract Analysis Section */}
        <div style={{ marginBottom: '16px' }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <MaterialIcon type="smart_toy" />
            <strong>Abstract Feedback</strong>
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
          {isLoading ? 'Analyzing...' : 'Analyze Abstract Only'}
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

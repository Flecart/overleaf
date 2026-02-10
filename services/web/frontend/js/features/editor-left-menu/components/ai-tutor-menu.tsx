import { useCallback, useState } from 'react'
import LeftMenuButton from './left-menu-button'
import AITutorModal from './ai-tutor-modal'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useProjectContext } from '@/shared/context/project-context'
import { postJSON } from '@/infrastructure/fetch-json'
import RangesTracker from '@overleaf/ranges-tracker'
import {
  extractAbstract,
  analyzeAbstractWithOpenAI,
} from '../utils/ai-tutor-service'
import * as eventTracking from '../../../infrastructure/event-tracking'
import { ThreadId } from '../../../../../types/review-panel/review-panel'
import { CommentOperation } from '../../../../../types/change'

export default function AITutorMenu() {
  const [showModal, setShowModal] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { currentDocument } = useEditorOpenDocContext()
  const { projectId } = useProjectContext()

  const handleShowModal = useCallback(() => {
    eventTracking.sendMB('left-menu-ai-tutor')
    setError(null)
    setShowModal(true)
  }, [])

  const handleHideModal = useCallback(() => {
    setShowModal(false)
    setError(null)
  }, [])

  const handleAnalyzeAbstract = useCallback(
    async (apiKey: string) => {
      if (!currentDocument) {
        setError('No document is currently open. Please open a document first.')
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        // Get the full document content from the document container
        const documentContent = currentDocument.getSnapshot()

        if (!documentContent) {
          setError('Unable to read document content. Please try again.')
          setIsLoading(false)
          return
        }

        // Extract the abstract
        const abstractData = extractAbstract(documentContent)
        if (!abstractData) {
          setError(
            'No abstract found in your document. Please ensure you have \\begin{abstract}...\\end{abstract} in your LaTeX.'
          )
          setIsLoading(false)
          return
        }

        // Analyze with OpenAI
        const result = await analyzeAbstractWithOpenAI(
          apiKey,
          abstractData.content,
          abstractData.startPos
        )

        if (!result.success) {
          setError(result.error || 'Failed to analyze abstract.')
          setIsLoading(false)
          return
        }

        // Add comments to the document
        for (const comment of result.comments) {
          const threadId = RangesTracker.generateId() as ThreadId

          // Create the thread message via API
          await postJSON(`/project/${projectId}/thread/${threadId}/messages`, {
            body: { content: comment.comment },
          })

          // Submit the comment operation to the document
          const op: CommentOperation = {
            c: comment.text,
            p: comment.startOffset,
            t: threadId,
          }

          currentDocument.submitOp(op)
        }

        // Success - close the modal
        setShowModal(false)
        setError(null)
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'An unexpected error occurred.'
        )
      } finally {
        setIsLoading(false)
      }
    },
    [currentDocument, projectId]
  )

  return (
    <>
      <h4>AI Tools</h4>
      <ul className="list-unstyled nav">
        <li>
          <LeftMenuButton onClick={handleShowModal} icon="school">
            AI Tutor
          </LeftMenuButton>
        </li>
      </ul>
      <AITutorModal
        show={showModal}
        handleHide={handleHideModal}
        onSubmit={handleAnalyzeAbstract}
        isLoading={isLoading}
        error={error}
      />
    </>
  )
}

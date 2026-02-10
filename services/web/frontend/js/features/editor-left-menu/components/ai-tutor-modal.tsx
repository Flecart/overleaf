import { useState, useCallback } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'

type AITutorModalProps = {
  show: boolean
  handleHide: () => void
  onSubmit: (apiKey: string) => void
  isLoading: boolean
  error: string | null
}

export default function AITutorModal({
  show,
  handleHide,
  onSubmit,
  isLoading,
  error,
}: AITutorModalProps) {
  const [apiKey, setApiKey] = useState('')

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (apiKey.trim()) {
        onSubmit(apiKey.trim())
      }
    },
    [apiKey, onSubmit]
  )

  return (
    <OLModal show={show} onHide={handleHide}>
      <OLModalHeader closeButton>
        <OLModalTitle>AI Writing Tutor</OLModalTitle>
      </OLModalHeader>
      <form onSubmit={handleSubmit}>
        <OLModalBody>
          <p>
            The AI Tutor will analyze your abstract and provide writing
            suggestions as comments in your document.
          </p>
          <OLFormGroup controlId="openai-api-key">
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
            <small className="text-muted">
              Your API key is only used for this session and is not stored.
            </small>
          </OLFormGroup>
          {error && (
            <div className="alert alert-danger mt-2" role="alert">
              {error}
            </div>
          )}
        </OLModalBody>
        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleHide} disabled={isLoading}>
            Cancel
          </OLButton>
          <OLButton
            variant="primary"
            type="submit"
            disabled={!apiKey.trim() || isLoading}
          >
            {isLoading ? 'Analyzing...' : 'Analyze Abstract'}
          </OLButton>
        </OLModalFooter>
      </form>
    </OLModal>
  )
}

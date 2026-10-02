'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useTRPC } from '@/lib/trpc'
import {
  CREATE_EVENT_DEFAULTS,
  type CreateEventValues,
} from '@/lib/create-event-schema'

import { FormView } from '@/components/dashboard/create-event/form-view'
import { PreviewView } from '@/components/dashboard/create-event/preview-view'
import { SubmitModal } from '@/components/dashboard/create-event/submit-modal'

const STEP_VALUES = ['form', 'preview'] as const

function buildPayload(
  values: CreateEventValues,
  banner: string | null,
  status: 'draft' | 'in-review'
) {
  return {
    title: values.title,
    description: values.description,
    date: values.date,
    endDate: values.endDate,
    time: values.time,
    location: values.location,
    bannerUrl: banner,
    features: values.features,
    tiers: values.tiers.map((t) => ({
      name: t.name,
      quantity: t.quantity,
      // Form prices are in major units (₦); convert to minor (kobo)
      priceMinor: Math.round(t.price * 100),
    })),
    assignedVendorIds: values.assignedVendorIds,
    externalInvites: values.externalInvites,
    status,
  }
}

export function CreateEventContent() {
  const router = useRouter()
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [step, setStep] = useQueryState(
    'step',
    parseAsStringLiteral(STEP_VALUES).withDefault('form')
  )
  const [values, setValues] = useState<CreateEventValues>(CREATE_EVENT_DEFAULTS)
  const [banner, setBanner] = useState<string | null>(null)
  const [submitOpen, setSubmitOpen] = useState(false)

  const create = useMutation(
    trpc.org.events.create.mutationOptions({
      onSuccess: ({ id, status }) => {
        queryClient.invalidateQueries({
          queryKey: trpc.org.events.list.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.org.dashboard.stats.queryKey(),
        })
        queryClient.invalidateQueries({
          queryKey: trpc.org.dashboard.recentActivity.queryKey(),
        })

        // The server decides the status it was saved with — asking to go
        // live does not make it live — so follow what came back, not what
        // was sent.
        if (status === 'draft') {
          toast.success('Draft saved')
          router.push(`/org/events/${id}`)
        } else {
          setSubmitOpen(true)
        }
      },
      onError: (e) =>
        toast.error('Could not save event', { description: e.message }),
    })
  )

  function handleSaveDraft() {
    create.mutate(buildPayload(values, banner, 'draft'))
  }

  function handleSubmit() {
    create.mutate(buildPayload(values, banner, 'in-review'))
  }

  return (
    <>
      {step === 'preview' ? (
        <PreviewView
          values={values}
          banner={banner}
          onEdit={() => void setStep('form')}
          onCancel={() => void setStep('form')}
          onSubmit={handleSubmit}
          submitting={create.isPending}
        />
      ) : (
        <FormView
          values={values}
          onChange={setValues}
          banner={banner}
          onBannerChange={setBanner}
          onPreview={() => void setStep('preview')}
          onSaveDraft={handleSaveDraft}
        />
      )}
      <SubmitModal open={submitOpen} onClose={() => setSubmitOpen(false)} />
    </>
  )
}

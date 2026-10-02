'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CheckmarkBadge01Icon,
  InformationCircleIcon,
  SquareLock02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'

import { calculateFeeMinor } from '@ticketur/api/lib/fees'
import { validateAnswers } from '@ticketur/api/lib/form-fields'
import { cn } from '@ticketur/ui/lib/utils'
import { Button } from '@ticketur/ui/components/button'
import { Spinner } from '@ticketur/ui/components/spinner'

import { useTRPC } from '@/lib/trpc'
import { useSession } from '@/lib/auth-client'
import { formatNaira } from '@/lib/event-display'
import {
  clearDraft,
  draftHasAnswers,
  readDraft,
  writeDraft,
} from '@/components/sections/forms/form-draft'
import { FormFieldInput } from '@/components/sections/forms/form-field-input'
import { FormPriceOptions } from '@/components/sections/forms/form-price-options'
import {
  FormSigninDialog,
  type SigninReason,
} from '@/components/sections/forms/form-signin-dialog'
import type { SubmittedResult } from '@/components/sections/forms/form-submitted'
import {
  toAnswerField,
  type AnswerDraft,
  type OpenForm,
} from '@/components/sections/forms/types'

// What the applicant was doing when sign-in got in the way, so it can be
// picked up again afterwards instead of making them tap the same button twice.
type Intent = 'submit' | 'upload' | null

export type SubmittedApplication = {
  result: SubmittedResult
  formTitle: string
  event: OpenForm['event']
  email: string | null
}

export function FormApply({
  data,
  slug,
  onRefetch,
  onSubmitted,
}: {
  data: OpenForm
  slug: string
  // Capacity, sold-out options and the form's own availability all move while
  // someone is filling this in. A refusal is the signal to go and look again.
  onRefetch: () => void
  // The confirmation is handed to the page rather than held here. Taking the
  // last spot makes the form 'full', and a refetch that lands afterwards would
  // otherwise unmount this component and take the applicant's reference with
  // it — the one thing on the page they need to keep.
  onSubmitted: (application: SubmittedApplication) => void
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const session = useSession()

  const { fields, priceOptions, form, event, serviceFeeBps } = data
  const returnTo = `/forms/${slug}`

  // The popup sign-in resolves before the session store catches up, and the
  // upload fields need to know at once. Trusting either is enough.
  const [signedInHere, setSignedInHere] = useState(false)
  const signedIn = Boolean(session.data?.user) || signedInHere
  const applicantEmail = session.data?.user?.email ?? null

  // send() is resumed from a timeout once the dialog closes, so it would
  // otherwise read the `signedIn` of the render that opened the dialog —
  // false — and open it all over again.
  const signedInRef = useRef(signedIn)
  signedInRef.current = signedIn

  const [answers, setAnswers] = useState<AnswerDraft>({})
  const [priceOptionId, setPriceOptionId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [optionError, setOptionError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState<Record<string, boolean>>({})
  const [leaving, setLeaving] = useState(false)

  const [signinOpen, setSigninOpen] = useState(false)
  const [signinReason, setSigninReason] = useState<SigninReason>('submit')
  const intentRef = useRef<Intent>(null)

  // ── Draft: restore, then save on every change ─────────────────────────────
  // Restoring runs after mount (localStorage is browser-only), so saving has
  // to wait for it — otherwise the empty first render overwrites the draft it
  // is about to read.
  const [restored, setRestored] = useState(false)
  const [restoredNotice, setRestoredNotice] = useState(false)
  const optionsRef = useRef(priceOptions)
  optionsRef.current = priceOptions

  useEffect(() => {
    const draft = readDraft(slug)
    if (draft) {
      setAnswers(draft.answers)
      // A sold-out or deleted option isn't worth restoring: it would only
      // fail at submit.
      const option = optionsRef.current.find(
        (o) => o.id === draft.priceOptionId && !o.soldOut
      )
      setPriceOptionId(option?.id ?? null)
      if (draftHasAnswers(draft)) setRestoredNotice(true)
    }
    setRestored(true)
  }, [slug])

  const stateRef = useRef({ answers, priceOptionId })
  stateRef.current = { answers, priceOptionId }

  // Write straight away rather than on a timer, for the one case that matters:
  // leaving the page. Used before every navigation.
  const saveNow = useCallback(() => {
    if (!restored) return
    writeDraft(slug, stateRef.current)
  }, [restored, slug])

  useEffect(() => {
    if (!restored) return
    const timer = window.setTimeout(() => {
      writeDraft(slug, { answers, priceOptionId })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [restored, slug, answers, priceOptionId])

  // A phone backgrounding the tab is the most common way this page dies.
  useEffect(() => {
    const save = () => saveNow()
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', save)
    }
  }, [saveNow])

  // ── Validation ────────────────────────────────────────────────────────────
  // The very function the server validates with, so the applicant gets an
  // error per question instead of one sentence about the first one. The server
  // still decides; this only moves the conversation earlier.
  const answerFields = useMemo(() => fields.map(toAnswerField), [fields])

  const selectedOption =
    priceOptions.find((o) => o.id === priceOptionId) ?? null
  const amountMinor = selectedOption?.priceMinor ?? 0
  // Registration fees now carry the platform service fee, as ticket sales
  // always have. The rate rode in on the same bySlug query that priced the
  // options, so it is already here; submit re-reads it server-side and that
  // figure is the one charged, so this can only ever be a preview.
  const feeMinor = calculateFeeMinor(amountMinor, serviceFeeBps)
  const payableMinor = amountMinor + feeMinor
  const uploading = Object.values(uploadBusy).some(Boolean)

  function focusProblem(fieldId: string | null) {
    const anchor = fieldId ? `anchor-${fieldId}` : 'anchor-options'
    const element = document.getElementById(anchor)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (fieldId) {
      window.setTimeout(() => {
        document
          .getElementById(`field-${fieldId}`)
          ?.focus({ preventScroll: true })
      }, 300)
    }
  }

  function check() {
    const checked = validateAnswers(answerFields, answers)
    const nextErrors: Record<string, string> = {}
    if (!checked.ok) {
      for (const error of checked.errors)
        nextErrors[error.fieldId] = error.message
    }

    let nextOptionError: string | null = null
    if (priceOptions.length > 0) {
      if (!priceOptionId) {
        nextOptionError = 'Pick one to continue.'
      } else if (!selectedOption) {
        nextOptionError = 'That option is no longer on this form. Pick another.'
      } else if (selectedOption.soldOut) {
        nextOptionError = `${selectedOption.name} is sold out. Pick another.`
      }
    }

    setErrors(nextErrors)
    setOptionError(nextOptionError)

    if (nextOptionError) {
      focusProblem(null)
      return null
    }
    const firstBad = fields.find((f) => nextErrors[f.id])
    if (firstBad) {
      focusProblem(firstBad.id)
      return null
    }
    return checked.ok ? checked.answers : null
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const submit = useMutation(
    trpc.public.forms.submit.mutationOptions({
      onSuccess: (response) => {
        if (response.requiresPayment) {
          if (!response.paymentUrl) {
            setFormError(
              `Your application was created (reference ${response.reference}) but we couldn't open the payment page. Contact support and quote that reference.`
            )
            return
          }
          // The draft stays. A cancelled or failed payment brings them back
          // here to apply again, and re-typing everything would be the second
          // insult. The unpaid application is replaceable after a minute.
          saveNow()
          setLeaving(true)
          window.location.href = response.paymentUrl
          return
        }

        clearDraft(slug)
        onSubmitted({
          result: {
            reference: response.reference,
            status: response.status,
          },
          formTitle: form.title,
          event,
          email: applicantEmail,
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      },
      onError: (error) => {
        const code = error.data?.code

        if (code === 'UNAUTHORIZED') {
          saveNow()
          intentRef.current = 'submit'
          setSigninReason('submit')
          setSigninOpen(true)
          return
        }

        setFormError(error.message)

        // CONFLICT is the form filling up, an option going, or an application
        // already on file. BAD_REQUEST includes the form closing mid-session.
        // Either way what's on screen is now out of date — and in no case are
        // the answers touched.
        if (code === 'CONFLICT' || code === 'BAD_REQUEST') onRefetch()

        window.setTimeout(() => {
          document
            .getElementById('form-submit-error')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 0)
      },
    })
  )

  const sending = submit.isPending || leaving

  // Tapping submit while the last photo is at 90% should not be refused: the
  // applicant has done their part. The submit waits for the upload instead,
  // and the button says so.
  const [waitingForUploads, setWaitingForUploads] = useState(false)
  const sendRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!waitingForUploads || uploading) return
    setWaitingForUploads(false)
    sendRef.current()
  }, [waitingForUploads, uploading])

  function send() {
    setFormError(null)

    // Before validating, not after: a photo that is still at 90% has no URL
    // yet, so validating first would tell them their required photo is
    // missing when it is in fact on its way.
    if (uploading) {
      setWaitingForUploads(true)
      return
    }

    const validated = check()
    if (!validated) return

    if (!signedInRef.current) {
      // Saved before the dialog opens, so even the paths that do navigate
      // (creating an account, 2FA) can't cost them anything.
      saveNow()
      intentRef.current = 'submit'
      setSigninReason('submit')
      setSigninOpen(true)
      return
    }

    submit.mutate({
      formId: form.id,
      priceOptionId: priceOptions.length > 0 ? priceOptionId : null,
      answers: validated,
    })
  }
  sendRef.current = send

  function handleSignedIn() {
    setSigninOpen(false)
    setSignedInHere(true)
    signedInRef.current = true
    // The header is server-rendered from the session.
    router.refresh()
    const intent = intentRef.current
    intentRef.current = null
    // The blocked uploads start themselves off `signedIn`; only a submit has
    // to be resumed by hand.
    if (intent === 'submit') {
      // Through the ref: by the time this runs React has re-rendered, so
      // this is the send() that knows about any upload that just
      // started off the new session.
      window.setTimeout(() => sendRef.current(), 0)
    }
  }

  function requestUploadSignin() {
    saveNow()
    intentRef.current = 'upload'
    setSigninReason('upload')
    setSigninOpen(true)
  }

  function setAnswer(fieldId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }))
    // Clear this question's error as it is fixed, but don't re-run the whole
    // form: turning every field red while someone types in the first one is
    // the classic way to make a form feel hostile.
    setErrors((prev) => {
      if (!prev[fieldId]) return prev
      const next = { ...prev }
      delete next[fieldId]
      return next
    })
  }

  const errorCount = Object.keys(errors).length + (optionError ? 1 : 0)

  return (
    <>
      <div className="flex flex-col gap-6">
        {restoredNotice ? (
          <Notice tone="muted" icon={CheckmarkBadge01Icon}>
            <span>
              We brought back the answers you started earlier.{' '}
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => {
                  clearDraft(slug)
                  setAnswers({})
                  setPriceOptionId(null)
                  setErrors({})
                  setOptionError(null)
                  setRestoredNotice(false)
                }}
              >
                Start fresh instead
              </button>
            </span>
          </Notice>
        ) : null}

        {!signedIn ? (
          <Notice tone="info" icon={SquareLock02Icon}>
            <span>
              <span className="font-medium">
                You&apos;ll sign in to submit this.
              </span>{' '}
              Fill it in now — your answers are kept on this device, so signing
              in later won&apos;t lose them.{' '}
              <button
                type="button"
                className="text-primary font-semibold underline underline-offset-4"
                onClick={() => {
                  saveNow()
                  intentRef.current = null
                  setSigninReason('submit')
                  setSigninOpen(true)
                }}
              >
                Sign in now
              </button>
            </span>
          </Notice>
        ) : null}

        {data.spotsLeft !== null && data.spotsLeft <= 10 ? (
          <Notice tone="warning" icon={UserGroupIcon}>
            {data.spotsLeft === 0
              ? 'The last spot has just gone — this form is about to close.'
              : `Only ${data.spotsLeft} spot${data.spotsLeft === 1 ? '' : 's'} left. Spots are taken when an application is submitted, not when the page is opened.`}
          </Notice>
        ) : null}

        <form
          className="flex flex-col gap-7"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          {priceOptions.length > 0 ? (
            <FormPriceOptions
              options={priceOptions}
              selectedId={priceOptionId}
              onSelect={(id) => {
                setPriceOptionId(id)
                setOptionError(null)
              }}
              error={optionError}
              disabled={sending}
            />
          ) : null}

          {fields.length > 0 ? (
            <div className="flex flex-col gap-7">
              {fields.map((field) => (
                <FormFieldInput
                  key={field.id}
                  field={field}
                  value={answers[field.id]}
                  onChange={(value) => setAnswer(field.id, value)}
                  error={errors[field.id] ?? null}
                  signedIn={signedIn}
                  onRequestSignin={requestUploadSignin}
                  onBusyChange={(busy) =>
                    setUploadBusy((prev) =>
                      prev[field.id] === busy
                        ? prev
                        : { ...prev, [field.id]: busy }
                    )
                  }
                  disabled={sending}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              This form has no questions — applying is all that&apos;s needed.
            </p>
          )}

          <div className="border-border flex flex-col gap-4 border-t pt-6">
            {errorCount > 0 ? (
              <p
                role="alert"
                className="text-destructive flex items-start gap-2 text-sm"
              >
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="mt-0.5 size-4 shrink-0"
                  strokeWidth={2}
                />
                {errorCount === 1
                  ? 'One answer needs fixing before this can be sent.'
                  : `${errorCount} answers need fixing before this can be sent.`}
              </p>
            ) : null}

            {formError ? (
              <div
                id="form-submit-error"
                role="alert"
                className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-xl border p-4 text-sm leading-6"
              >
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="mt-0.5 size-4 shrink-0"
                  strokeWidth={2}
                />
                <span>
                  {formError}
                  <span className="text-muted-foreground mt-1 block text-xs">
                    Your answers are still here — nothing was lost.
                  </span>
                </span>
              </div>
            ) : null}

            {amountMinor > 0 ? (
              <div className="bg-muted/50 flex flex-col gap-2 rounded-xl px-4 py-3">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">
                    {selectedOption?.name}
                  </span>
                  <span className="text-foreground font-semibold">
                    {formatNaira(amountMinor)}
                  </span>
                </div>
                {feeMinor > 0 ? (
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Service fee</span>
                    <span className="text-foreground font-semibold">
                      {formatNaira(feeMinor)}
                    </span>
                  </div>
                ) : null}
                <div className="border-border/60 flex items-baseline justify-between gap-4 border-t pt-2">
                  <span className="text-foreground text-sm font-semibold">
                    Total
                  </span>
                  <span className="font-heading text-foreground text-lg font-bold">
                    {formatNaira(payableMinor)}
                  </span>
                </div>
              </div>
            ) : null}

            <Button
              type="submit"
              size="xl"
              className="w-full"
              disabled={sending || waitingForUploads}
            >
              {leaving ? (
                <>
                  <Spinner />
                  Taking you to payment…
                </>
              ) : submit.isPending ? (
                <>
                  <Spinner />
                  Sending your application…
                </>
              ) : waitingForUploads ? (
                <>
                  <Spinner />
                  Waiting for your files…
                </>
              ) : amountMinor > 0 ? (
                `Pay ${formatNaira(payableMinor)} and apply`
              ) : (
                'Submit application'
              )}
            </Button>

            <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
              <HugeiconsIcon
                icon={InformationCircleIcon}
                className="mt-px size-3.5 shrink-0"
                strokeWidth={1.8}
              />
              <span>
                {amountMinor > 0
                  ? 'You pay through Flutterwave on the next screen. Your spot is held while you pay, and your application completes once the payment clears.'
                  : data.reviewMode === 'auto'
                    ? 'Your spot is confirmed as soon as you apply, and your reference is emailed to you.'
                    : "The organizer reviews every application. We'll email you your reference now and their decision when they make it."}
              </span>
            </p>
          </div>
        </form>
      </div>

      <FormSigninDialog
        open={signinOpen}
        onOpenChange={(open) => {
          setSigninOpen(open)
          if (!open) intentRef.current = null
        }}
        reason={signinReason}
        returnTo={returnTo}
        onSignedIn={handleSignedIn}
        onBeforeLeave={saveNow}
      />
    </>
  )
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: 'info' | 'warning' | 'muted'
  icon: React.ComponentProps<typeof HugeiconsIcon>['icon']
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-4 text-sm leading-6',
        tone === 'info' && 'border-primary/30 bg-primary/5 text-foreground',
        tone === 'warning' &&
          'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
        tone === 'muted' && 'border-border bg-muted/40 text-muted-foreground'
      )}
    >
      <HugeiconsIcon
        icon={icon}
        className="mt-0.5 size-4 shrink-0"
        strokeWidth={1.8}
      />
      {children}
    </div>
  )
}

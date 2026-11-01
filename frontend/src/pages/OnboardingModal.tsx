import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { orgApi, ApiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * ABN client-side validation — ATO checksum algorithm.
 * Mirrors the backend implementation in src/lib/abn.ts.
 */
function validateABN(raw: string): boolean {
  const digits = raw.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const first = Number(digits[0]) - 1;
  const rest = digits.slice(1).split('').map(Number);
  const adjusted = [first, ...rest];
  const sum = adjusted.reduce((acc, d, i) => acc + d * (weights[i] ?? 0), 0);
  return sum % 89 === 0;
}

/**
 * OnboardingModal — shown to users who have authenticated with Google but
 * have no organization yet (status === 'onboarding').
 *
 * Collects: Organization Legal Name + ABN.
 * On success: calls completeOnboarding() to update auth state.
 */
export function OnboardingModal() {
  const { completeOnboarding } = useAuth();

  const [name, setName] = useState('');
  const [abn, setAbn] = useState('');
  const [errors, setErrors] = useState<{ name?: string; abn?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const next: typeof errors = {};

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      next.name = 'Organization name must be at least 2 characters.';
    } else if (trimmedName.length > 100) {
      next.name = 'Organization name must be 100 characters or fewer.';
    }

    const trimmedABN = abn.replace(/\s/g, '');
    if (!/^\d{11}$/.test(trimmedABN)) {
      next.abn = 'ABN must be exactly 11 digits.';
    } else if (!validateABN(trimmedABN)) {
      next.abn = 'This ABN is not valid. Please check the number and try again.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setSubmitError(null);

    try {
      const res = await orgApi.create({
        name: name.trim(),
        abn: abn.replace(/\s/g, ''),
      });
      completeOnboarding(res.organization.id, res.role);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrors((e) => ({
            ...e,
            abn: 'An organization with this ABN already exists.',
          }));
        } else {
          setSubmitError(err.message);
        }
      } else {
        setSubmitError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  // Format ABN as user types: XX XXX XXX XXX
  function handleAbnChange(value: string) {
    // Strip non-digits, cap at 11
    const digits = value.replace(/\D/g, '').slice(0, 11);
    // Format groups: 2 + 3 + 3 + 3
    const parts: string[] = [];
    if (digits.length > 0) parts.push(digits.slice(0, 2));
    if (digits.length > 2) parts.push(digits.slice(2, 5));
    if (digits.length > 5) parts.push(digits.slice(5, 8));
    if (digits.length > 8) parts.push(digits.slice(8, 11));
    setAbn(parts.join(' '));
    if (errors.abn) setErrors((e) => ({ ...e, abn: undefined }));
  }

  return (
    <Modal
      open
      title="Create your organization"
      description="Enter your business details to get started. You'll be set as the Admin."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <Input
          label="Organization Legal Name"
          placeholder="Acme Trading Pty Ltd"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) setErrors((er) => ({ ...er, name: undefined }));
          }}
          error={errors.name}
          autoFocus
          maxLength={100}
          disabled={loading}
        />

        <Input
          label="Australian Business Number (ABN)"
          placeholder="12 345 678 901"
          value={abn}
          onChange={(e) => handleAbnChange(e.target.value)}
          error={errors.abn}
          hint="Your 11-digit ABN as registered with the ATO."
          inputMode="numeric"
          disabled={loading}
        />

        {submitError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{submitError}</p>
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          loading={loading}
        >
          Create Organization
        </Button>
      </form>
    </Modal>
  );
}


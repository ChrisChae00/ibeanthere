'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useErrorTranslator } from '@/hooks/useErrorTranslator';
import { createClient } from '@/shared/lib/supabase/client';
import { capture } from '@/lib/analytics';
import {
  ErrorAlert,
  Button,
  Input
} from '@/components/ui';

interface CompleteProfileFormProps {
  locale: string;
  returnUrl?: string; // Where to redirect after success
}

export function CompleteProfileForm({ locale, returnUrl = '/' }: CompleteProfileFormProps) {
  const t = useTranslations('auth'); // Reuse auth translations
  const tErrors = useTranslations('errors');
  const [formData, setFormData] = useState({
    username: '',
    displayName: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  
  // Async validation state
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [isUsernameAvailable, setIsUsernameAvailable] = useState(false);
  
  const supabase = createClient();
  const { translateError } = useErrorTranslator();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    
    if (name === 'username') {
      setUsernameError('');
      setIsUsernameAvailable(false);
    }
  };

  const validateUsername = (username: string): { isValid: boolean; error?: string } => {
    // 1. Allow only lowercase letters, numbers, underscores (_), and hyphens (-) - Instagram style
    const allowedCharsRegex = /^[a-z0-9_-]+$/;
    if (!allowedCharsRegex.test(username)) {
      return { isValid: false, error: 'username_lowercase_only' };
    }

    // 2. Length between 3 and 20 characters
    if (username.length < 3 || username.length > 20) {
      return { isValid: false, error: 'username_length' };
    }

    // 3. Start with a letter
    const startsWithLetterRegex = /^[a-z]/;
    if (!startsWithLetterRegex.test(username)) {
      return { isValid: false, error: 'username_start_letter' };
    }

    // 4. Prohibit reserved words
    const reservedWords = [
      'admin', 'admin_account', 'root', 'api', 'www', 'test', 'user', 'guest', 'null', 'undefined',
      'support', 'help', 'ibeanthere', 'system', 'manager', 'official', 'operator'
    ];
    if (reservedWords.includes(username)) {
      return { isValid: false, error: 'username_reserved' };
    }

    // 5. Prohibit only numbers
    const onlyNumbersRegex = /^\d+$/;
    if (onlyNumbersRegex.test(username)) {
      return { isValid: false, error: 'username_only_numbers' };
    }

    // 6. Prohibit overly simple patterns
    const simplePatternRegex = /^(.)\1+$|^abc$|^qwe$|^asd$|^zxc$/i;
    if (simplePatternRegex.test(username)) {
      return { isValid: false, error: 'username_too_simple' };
    }

    return { isValid: true };
  };

  // Debounced username check
  useEffect(() => {
    const checkUsername = async () => {
      const username = formData.username;
      if (!username || username.length < 3) return;
      
      const validation = validateUsername(username);
      if (!validation.isValid) return; // Don't check API if basic validation fails

      setIsCheckingUsername(true);
      setIsUsernameAvailable(false);
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const response = await fetch(`${apiUrl}/api/v1/users/check-username/${username}`);
        if (response.ok) {
           const data = await response.json();
           if (!data.available) {
             setUsernameError('username_taken');
             setIsUsernameAvailable(false);
           } else {
             setIsUsernameAvailable(true);
           }
        }
      } catch (err) {
        console.error('Failed to check username availability', err);
      } finally {
        setIsCheckingUsername(false);
      }
    };

    const timer = setTimeout(checkUsername, 500);
    return () => clearTimeout(timer);
  }, [formData.username]);

  const validation = validateUsername(formData.username);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (!validation.isValid) {
      setError(tErrors(validation.error!));
      setIsLoading(false);
      return;
    }
    
    if (usernameError) {
        setError(tErrors(usernameError));
        setIsLoading(false);
        return;
    }

    if (!agreeToTerms) {
      setError(tErrors('terms_required'));
      setIsLoading(false);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError(translateError('Session expired. Please sign in again.'));
        setIsLoading(false);
        return;
      }

      const accessToken = session.access_token;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      
      const payload = JSON.stringify({
        username: formData.username,
        display_name: formData.displayName || formData.username,
        terms_accepted: true,
        privacy_accepted: true,
        consent_version: '1.0.0'
      });

      const response = await fetch(`${apiUrl}/api/v1/users/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: payload,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to update profile');
      }

      // Mostly Google accounts land here, but an older email account missing its
      // terms consent does too, so the method comes from the account itself.
      capture('signed_up', { method: session.user.app_metadata.provider });

      // CRITICAL STEP: Update Supabase Auth Metadata locally!
      // The backend updates the database, but Supabase Auth Session (JWT) needs to be refreshed
      // with the new username so that useAuth hook knows the profile is complete.
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          username: formData.username,
          display_name: formData.displayName || formData.username,
          terms_accepted: true, // Optimistic update
          privacy_accepted: true
        }
      });

      if (updateError) {
        console.warn('Failed to update Supabase Auth metadata:', updateError.message);
        // We continue anyway because the DB entry is correct.
        // A page reload (window.location.href) usually forces a session refresh.
      } else {
        // Force session refresh to be sure
        await supabase.auth.refreshSession();
      }

      // Success - Redirect
      // Handle relative paths carefully with locale
      const redirectPath = returnUrl.startsWith('/') ? returnUrl : `/${returnUrl}`;
      // Ensure we don't redirect back to onboarding/complete-profile loops if returnUrl was somehow set to that
      const finalUrl = redirectPath.includes('complete-profile') ? `/${locale}` : redirectPath;
      
      window.location.href = finalUrl;

    } catch (err: any) {
      setError(translateError(err.message || 'unknown'));
    } finally {
      setIsLoading(false);
    }
  };

  // Determine helper text or error
  let inputError = undefined;
  if (validation.error && formData.username.length > 0) {
      inputError = tErrors(validation.error);
  } else if (usernameError) {
      inputError = tErrors(usernameError);
  }

  let helperText = t('username_hint');
  if (isCheckingUsername) {
      helperText = t('checking_availability') || 'Checking availability...';
  } else if (isUsernameAvailable && !inputError) {
      helperText = t('username_available') || 'Username is available';
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <ErrorAlert message={error} />

      <div className="space-y-4">
        <Input
          name="username"
          label={t('username')}
          placeholder={t('username_placeholder')}
          value={formData.username}
          onChange={handleInputChange}
          error={inputError}
          helperText={helperText}
          helperTextClassName={isUsernameAvailable && !inputError ? 'text-success' : ''}
          required
        />
        
        <Input
          name="displayName"
          label={t('display_name')}
          placeholder={t('display_name_placeholder')}
          value={formData.displayName}
          onChange={handleInputChange}
          helperText={t('display_name_hint')}
          required
        />

        {/* Terms Agreement */}
        <div className="flex items-start space-x-3">
          <input
            type="checkbox"
            checked={agreeToTerms}
            onChange={(e) => setAgreeToTerms(e.target.checked)}
            className="w-4 h-4 text-primary border-border rounded-sm focus:ring-primary mt-1"
            required
          />
          <label className="text-sm text-ink-secondary">
            {t('terms_agreement')}{' '}
            <Link href={`/${locale}/terms`} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-secondary underline font-medium transition-colors">
              {t('terms_of_service')}
            </Link>{' '}
            {t('and')}{' '}
            <Link href={`/${locale}/privacy`} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-secondary underline font-medium transition-colors">
              {t('privacy_policy')}
            </Link>
          </label>
        </div>

        <Button
          type="submit"
          fullWidth
          size="lg"
          className="bg-primary hover:bg-secondary text-white transition-colors"
          disabled={isLoading || isCheckingUsername || !!inputError || !validation.isValid || !agreeToTerms}
          loading={isLoading}
        >
          {t('complete_setup')}
        </Button>
      </div>
    </form>
  );
}

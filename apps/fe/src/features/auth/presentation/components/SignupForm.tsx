'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { createClient } from '@/shared/lib/supabase/client';
import { useOAuthSignIn } from '@/hooks/useOAuthSignIn';
import { capture } from '@/lib/analytics';
import { useErrorTranslator } from '@/hooks/useErrorTranslator';
import {
  EyeIcon,
  EyeOffIcon,
  GoogleIcon,
  ErrorAlert,
  Button,
  Input
} from '@/components/ui';

/* Pill fields, matching the pill buttons above and below them. */
const FIELD = 'rounded-full pl-5';

interface SignupFormProps {
  locale: string;
}

export function SignupForm({ locale }: SignupFormProps) {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Async validation state
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [isUsernameAvailable, setIsUsernameAvailable] = useState(false);

  const supabase = createClient();
  const { isLoading: oauthLoading, error: oauthError, signInWithOAuth } = useOAuthSignIn();
  const { translateError } = useErrorTranslator();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    
    if (name === 'email') {
      setError('');
    }
    if (name === 'username') {
      setUsernameError('');
      setIsUsernameAvailable(false);
    }
  };

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
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

    // 6. Prohibit overly simple patterns (e.g., aaa, abc, 123, etc.)
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
      if (!validation.isValid) return;

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


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Validation
    const usernameValidation = validateUsername(formData.username);
    if (!usernameValidation.isValid) {
      setError(tErrors(usernameValidation.error!));
      setIsLoading(false);
      return;
    }

    if (usernameError) {
        setError(tErrors(usernameError));
        setIsLoading(false);
        return;
    }

    if (!validateEmail(formData.email)) {
      setError(tErrors('invalid_email'));
      setIsLoading(false);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError(tErrors('passwords_not_match'));
      setIsLoading(false);
      return;
    }

    if (!agreeToTerms) {
      setError(tErrors('terms_required'));
      setIsLoading(false);
      return;
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            username: formData.username,
            display_name: formData.username,
            // Optimistically set terms_accepted true for local check
            terms_accepted: true,
            privacy_accepted: true
          },
        },
      });

      if (authError) {
        setError(translateError(authError.message));
        setIsLoading(false);
        return;
      }

      // Supabase answers a repeat signup for an existing email with a user that has no
      // identities instead of an error, so that one is not a new account.
      if (authData.user?.identities?.length) {
        capture('signed_up', { method: 'email' });
      }

      // After successful Supabase Auth signup, register user profile in backend
      // Note: Trigger automatically creates basic profile in public.users
      // This API call is just for updating username/display_name
      if (authData.user && authData.session?.access_token) {
        const accessToken = authData.session.access_token;
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        
        // Use fetch with keepalive for reliable delivery even during page unload
        // This ensures the request completes even if user navigates away
        try {
          const payload = JSON.stringify({
            username: formData.username,
            display_name: formData.username,
            terms_accepted: true,
            privacy_accepted: true,
            consent_version: '1.0.0'
          });
          
          // Use fetch with keepalive to ensure request completes during redirect
          fetch(`${apiUrl}/api/v1/users/register`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: payload,
            keepalive: true, // Critical: allows request to complete even during page unload
          }).then(response => {
            if (response.ok) {
              if (process.env.NODE_ENV === 'development') {
                console.info('Profile API call succeeded - username and display_name updated');
              }
            } else {
              if (process.env.NODE_ENV === 'development') {
                response.json().then(errorData => {
                   // If error is forbidden/bad request (like admin reserved), we might want to know.
                   // But since we are redirecting, we can't show it easily unless we wait.
                   // Since we validated async before submit, this should be rare.
                  console.warn('Profile API call failed (non-critical):', errorData.detail || 'Unknown error');
                }).catch(() => {
                  console.warn('Profile API call failed (non-critical):', response.status, response.statusText);
                });
              }
            }
          }).catch(error => {
            // Network errors are expected if page unloads - silently ignore
            if (process.env.NODE_ENV === 'development') {
              console.warn('Profile API call error (non-critical - may be due to page navigation):', error.message || error);
            }
          });
        } catch (error) {
          // Silently ignore - trigger handles basic profile
          if (process.env.NODE_ENV === 'development') {
            console.warn('Profile API call setup error (non-critical):', error);
          }
        }
      }

      // Redirect immediately after auth signup succeeds
      // keepalive: true ensures the API call completes even during redirect
      window.location.href = `/${locale}`;
    } catch (err) {
      setError(tErrors('unknown'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = () => {
    signInWithOAuth('google', locale);
  };



  const displayError = error || oauthError;

  // Helpers for validation display
  const usernameValidation = validateUsername(formData.username);
  let usernameHelperText = t('username_hint');
  let usernameInputError = undefined;

  if (usernameValidation.error && formData.username.length > 0) {
      usernameInputError = tErrors(usernameValidation.error);
  } else if (usernameError) {
      usernameInputError = tErrors(usernameError);
  }

  if (isCheckingUsername) {
      usernameHelperText = t('checking_availability') || 'Checking availability...';
  } else if (isUsernameAvailable && !usernameInputError) {
      usernameHelperText = t('username_available') || 'Username is available';
  }

  return (
    <form onSubmit={handleSubmit} className="blur-fade-children space-y-5" noValidate>
      <ErrorAlert message={displayError} />

      <Button
        type="button"
        onClick={handleGoogleSignUp}
        disabled={oauthLoading}
        variant="outline"
        fullWidth
        leftIcon={<GoogleIcon size={20} />}
      >
        {t('continue_with_google')}
      </Button>

      <div className="flex items-center gap-4">
        <div className="flex-1 border-t border-edge-rule" />
        <span className="text-sm text-ink-secondary">{t('or')}</span>
        <div className="flex-1 border-t border-edge-rule" />
      </div>

      <div className="space-y-5">
        <Input
          label={t('username')}
          name="username"
          autoComplete="username"
          value={formData.username}
          onChange={handleInputChange}
          placeholder={t('username_placeholder')}
          helperText={usernameHelperText}
          helperTextClassName={isUsernameAvailable && !usernameInputError ? 'text-success' : ''}
          error={usernameInputError}
          required
          className={FIELD}
        />

        <Input
          label={t('email_address')}
          type="email"
          name="email"
          autoComplete="email"
          value={formData.email}
          onChange={handleInputChange}
          placeholder={t('email_placeholder')}
          required
          className={FIELD}
        />

        <Input
          label={t('password')}
          type={showPassword ? 'text' : 'password'}
          name="password"
          autoComplete="new-password"
          value={formData.password}
          onChange={handleInputChange}
          placeholder={t('create_password_placeholder')}
          required
          className={FIELD}
          endAdornment={
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? t('hide_password') : t('show_password')}
              className="rounded-full p-1 text-ink-secondary hover:text-ink-primary"
            >
              {showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
            </button>
          }
        />

        <Input
          label={t('confirm_password')}
          type={showConfirmPassword ? 'text' : 'password'}
          name="confirmPassword"
          autoComplete="new-password"
          value={formData.confirmPassword}
          onChange={handleInputChange}
          placeholder={t('confirm_password_placeholder')}
          required
          className={FIELD}
          endAdornment={
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? t('hide_password') : t('show_password')}
              className="rounded-full p-1 text-ink-secondary hover:text-ink-primary"
            >
              {showConfirmPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
            </button>
          }
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-ink-secondary select-none break-keep">
        <input
          type="checkbox"
          checked={agreeToTerms}
          onChange={(e) => setAgreeToTerms(e.target.checked)}
          className="mt-1 size-4 shrink-0 cursor-pointer accent-brand"
          required
        />
        <span>
          {t('terms_agreement')}{' '}
          <Link href={`/${locale}/terms`} target="_blank" rel="noopener noreferrer" className="text-ink-primary underline underline-offset-4 decoration-edge-rule hover:decoration-ink-primary">
            {t('terms_of_service')}
          </Link>{' '}
          {t('and')}{' '}
          <Link href={`/${locale}/privacy`} target="_blank" rel="noopener noreferrer" className="text-ink-primary underline underline-offset-4 decoration-edge-rule hover:decoration-ink-primary">
            {t('privacy_policy')}
          </Link>
        </span>
      </label>

      <Button
        type="submit"
        fullWidth
        loading={isLoading}
        disabled={isCheckingUsername || !!usernameInputError}
      >
        {t('create_account')}
      </Button>

      <p className="text-center text-sm text-ink-secondary">
        {t('already_have_account')}{' '}
        <Link
          href={`/${locale}/signin`}
          className="font-semibold text-ink-primary underline underline-offset-4 decoration-edge-rule hover:decoration-ink-primary"
        >
          {t('sign_in_link')}
        </Link>
      </p>
    </form>
  );
}

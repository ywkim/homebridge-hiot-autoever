import { describe, expect, it } from 'vitest';

import { HiotApiError, HiotAuthError, HiotConnectionError } from '../../src/api/errors.js';

describe('HiotApiError hierarchy', () => {
  it('HiotApiError exposes message and optional cause', () => {
    const cause = new Error('boom');
    const err = new HiotApiError('outer', cause);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('outer');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('HiotApiError');
  });

  it('HiotAuthError extends HiotApiError', () => {
    const err = new HiotAuthError('nope');
    expect(err).toBeInstanceOf(HiotApiError);
    expect(err.name).toBe('HiotAuthError');
  });

  it('HiotConnectionError extends HiotApiError', () => {
    const cause = new Error('ECONNRESET');
    const err = new HiotConnectionError('net', cause);
    expect(err).toBeInstanceOf(HiotApiError);
    expect(err.name).toBe('HiotConnectionError');
    expect(err.cause).toBe(cause);
  });
});

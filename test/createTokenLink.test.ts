import { describe, it, expect } from 'vitest';
import {
  TOKEN_CREATE_URL,
  tokenLinkLabel,
} from '../app/components/steps/step0/CreateTokenLink';

describe('CreateTokenLink helpers', () => {
  it('points at the Cloudflare user-owned tokens page', () => {
    expect(TOKEN_CREATE_URL).toBe('https://dash.cloudflare.com/profile/api-tokens');
  });

  it('labels a write credential as write-all', () => {
    expect(tokenLinkLabel('write')).toBe('Create a write-all token');
  });

  it('labels a read credential as read-all', () => {
    expect(tokenLinkLabel('read')).toBe('Create a read-all token');
  });
});

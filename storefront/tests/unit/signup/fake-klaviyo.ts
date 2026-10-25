import type {
  KlaviyoClient,
  SubscribeFailure,
  SubscribeRequest,
  SubscribeResult,
} from '~/lib/signup/klaviyo-client';

// A typed fake Klaviyo client for the signup tests (REQ-ANL-003). It records every request it is given and answers
// with whatever the test says; it never touches the network. All addresses are on the reserved example domains.

export type FakeKlaviyo = KlaviyoClient & {
  readonly calls: SubscribeRequest[];
};

export function fakeKlaviyo(
  respond: (request: SubscribeRequest) => SubscribeResult = () => ({
    status: 'accepted',
  }),
): FakeKlaviyo {
  const calls: SubscribeRequest[] = [];
  return {
    calls,
    subscribe(request) {
      calls.push(request);
      return Promise.resolve(respond(request));
    },
  };
}

export const failing = (reason: SubscribeFailure) => (): SubscribeResult => ({
  status: 'failed',
  reason,
});

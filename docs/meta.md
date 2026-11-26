# Meta integration setup

Use a Meta Developer app and test assets you are authorized to administer. Set `META_GRAPH_VERSION` to the Graph API version supported by your app, and configure the app ID, app secret, and random webhook verification token server-side.

## Facebook and Instagram lead ads

1. Configure [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/) and set its configuration ID in `META_FACEBOOK_CONFIG_ID`.
2. Set `PUBLIC_API_ORIGIN` to the browser-facing application origin. Register the exact OAuth callback `/api/v1/meta/facebook/callback` at this origin so the browser returns with the session and state cookie.
3. Configure a public HTTPS webhook at `/api/v1/webhooks/facebook`. Subscribe to the `page` object's `leadgen` field with the configured verification token. Relay checks the signed raw body using the app secret.
4. Verify the Lead Ads and Webhooks permission requirements for your app. Meta lists `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, and `ads_management` in its Leadgen webhook guide. Check `pages_manage_ads` and App Review requirements in the Lead Ads guide. Grant the app and user access in Leads Access Manager as applicable.
5. In Relay, connect Facebook, select the authorized Page and forms, and save. Test with Meta’s Lead Ads Testing Tool. Instagram Instant Form leads appear through the connected Page. Use **Sync leads** for historical imports.
6. To permit automatic WhatsApp outreach for a real-time lead from one form, configure `META_OPT_IN_FORM_ID`, `META_OPT_IN_FIELD`, and `META_OPT_IN_ACCEPTED_VALUE` for a question whose wording explicitly records opt-in. Leave them blank if there is no explicit opt-in question. Historical imports enter with unknown consent.

[Meta Lead Ads guide](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/) · [Meta Webhooks for Leads](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/)

## WhatsApp Cloud API

1. For development, use the Meta test number and allowlisted test recipients. Set `META_TEST_TOKEN`, `META_TEST_WABA_ID`, and `META_TEST_PHONE_ID`. The test-number button is disabled in production.
2. Configure [WhatsApp Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup/) for your business and app and set `META_WHATSAPP_CONFIG_ID`. Confirm the current signup event payload and registration flow for your Meta configuration during staging. Check advanced access for `whatsapp_business_management` and `whatsapp_business_messaging`, and the applicable Tech Provider, billing, App Review and Business Verification requirements. Enter a registration PIN during the flow if your number requires registration.
3. Configure `/api/v1/webhooks/whatsapp` for the `whatsapp_business_account` object's `messages` field. Connecting a number subscribes the app to its WABA.
4. Sync approved templates in **Templates**. Create an eligible synthetic lead, open its WhatsApp conversation, and use an approved template with the authorized test recipient. Confirm sent, delivered and read receipts and a reply in the shared inbox. Test a duplicate webhook, an opt-out, and a disabled automation.
5. Free-text messages require an active 24-hour customer service window. Templates require recorded consent. Inbound STOP, UNSUBSCRIBE, and OPT OUT set the lead to opted out. Ambiguous outbound provider responses are shown as unknown pending a receipt, to avoid duplicate sends.
6. Optionally set `MEDIA_ORIGIN` to the dedicated HTTPS origin serving approved files. An agent can send links from this origin within the service window. Incoming images and documents can be downloaded from an authorized conversation.

[Meta Cloud API overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform) · [Meta’s Cloud API reference collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)

## Staging status

The provider code uses official endpoints. Live account authorization, real lead retrieval, approved template delivery, and Embedded Signup must be checked with your app and authorized Meta test assets before launch.

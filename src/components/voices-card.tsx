import { Card } from "@/components/ui";
import { VoiceSetup } from "@/components/voice-ui";
import {
  elevenLabsConfigured,
  listVoices,
  subscription,
} from "@/lib/voice/elevenlabs";
import { cloneSamples, getVoiceProfiles } from "@/lib/voice/profiles";

/** Uco's and Ocu's AI voices (ElevenLabs): cloned from your booth takes, or a ready-made voice. */
export async function VoicesCard({ ownerId }: { ownerId: string }) {
  const voicesOn = elevenLabsConfigured();
  const [voices, ucoSamples, ocuSamples] = await Promise.all([
    getVoiceProfiles(ownerId).catch(
      () => ({}) as Awaited<ReturnType<typeof getVoiceProfiles>>,
    ),
    cloneSamples(ownerId, "uco").catch(() => ({ seconds: 0 })),
    cloneSamples(ownerId, "ocu").catch(() => ({ seconds: 0 })),
  ]);
  const [plan, library] = voicesOn
    ? await Promise.all([
        subscription().catch(() => null),
        listVoices().catch(() => []),
      ])
    : [null, []];
  const voiceOptions = library.map((v) => ({
    id: v.voice_id,
    label: [v.name, v.labels?.gender, v.labels?.age, v.labels?.accent]
      .filter(Boolean)
      .join(" · "),
    preview: v.preview_url,
  }));
  return (
    <Card title="AI voices">
      {voicesOn ? (
        <>
          {plan && (
            <p className="mb-2 text-xs text-muted">
              ElevenLabs {plan.tier} plan: {plan.used.toLocaleString()} of{" "}
              {plan.limit.toLocaleString()} characters used this month (one
              episode is about 700).
            </p>
          )}
          {!plan && (
            <p role="status" className="mb-2 text-xs text-muted">
              ElevenLabs isn&apos;t answering right now, so your plan and the voice list couldn&apos;t load. Your saved voices still work;
              reload in a minute to change them.
            </p>
          )}
          <ul className="divide-y divide-border">
            {(["uco", "ocu"] as const).map((sp) => {
              const v = voices[sp];
              return (
                <li key={sp} className="space-y-2 py-3">
                  <div className="font-medium">
                    {sp === "uco" ? "Uco" : "Ocu"}
                  </div>
                  <div className="text-xs text-muted">
                    {v
                      ? `Using ${v.name ?? "a voice"} (ElevenLabs, set ${v.created_at.toLocaleDateString()}).`
                      : "No AI voice yet."}
                  </div>
                  <VoiceSetup
                    speaker={sp}
                    hasVoice={Boolean(v)}
                    sampleSeconds={
                      (sp === "uco" ? ucoSamples : ocuSamples).seconds
                    }
                    canClone={plan ? plan.canClone : Boolean(v)}
                    voices={voiceOptions}
                    currentId={v?.voice_id}
                  />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted">
          Let the app voice scripts for you with ElevenLabs (free plan:
          ready-made voices; Starter: your own cloned voice). Add your
          ElevenLabs API key in Vercel as <code>ELEVENLABS_API_KEY</code>,
          redeploy, and the setup appears here.
        </p>
      )}
    </Card>
  );
}

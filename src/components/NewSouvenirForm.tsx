"use client";

import { useState } from "react";
import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { PlaceSearch } from "@/components/PlaceSearch";
import { SectionLabel } from "@/components/Shell";
import { useSession } from "@/components/SessionProvider";
import { withNewSouvenir, type Souvenir } from "@/lib/catalog";
import type { Found } from "@/lib/geocode";

/**
 * Creating a sticker.
 *
 * Lives on the home page because it is the first thing anyone needs to do,
 * and because a fresh account has nothing else to look at. `/admin` is for
 * managing what already exists.
 */

const BLANK_MANUAL = {
  city: "",
  country: "",
  countryCode: "",
  lat: "",
  lng: "",
};

export function NewSouvenirForm() {
  const { catalog, commit } = useSession();

  const [place, setPlace] = useState<Found | null>(null);
  const [manual, setManual] = useState(BLANK_MANUAL);
  const [byHand, setByHand] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<Souvenir | null>(null);

  if (!catalog) return null;

  const manualField = (key: keyof typeof BLANK_MANUAL) => ({
    value: manual[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setManual((current) => ({ ...current, [key]: event.target.value })),
  });

  /** Whichever source was used, validated the same way. */
  function resolvePlace(): Found | string {
    if (!byHand) {
      return place ?? "Busca el lugar y elígelo de la lista.";
    }

    const lat = Number(manual.lat);
    const lng = Number(manual.lng);

    if (!manual.city.trim() || !manual.country.trim()) {
      return "La ciudad y el país son obligatorios.";
    }
    if (!/^[A-Za-z]{2}$/.test(manual.countryCode.trim())) {
      return "El código de país son dos letras, como JP o ES.";
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return "La latitud va entre -90 y 90.";
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return "La longitud va entre -180 y 180.";
    }

    return {
      key: "manual",
      city: manual.city.trim(),
      country: manual.country.trim(),
      countryCode: manual.countryCode.trim().toUpperCase(),
      lat,
      lng,
      label: `${manual.city.trim()}, ${manual.country.trim()}`,
    };
  }

  // An arrow const rather than a function declaration: declarations hoist
  // above the `if (!catalog)` guard, so TypeScript would analyse the body
  // without knowing the catalogue is loaded by the time this can run.
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);

    const resolved = resolvePlace();
    if (typeof resolved === "string") {
      setProblem(resolved);
      return;
    }

    setSaving(true);
    try {
      const { catalog: next, souvenir } = withNewSouvenir(catalog, {
        city: resolved.city,
        country: resolved.country,
        countryCode: resolved.countryCode,
        lat: resolved.lat,
        lng: resolved.lng,
      });
      await commit(next);
      setCreated(souvenir);
      setPlace(null);
      setManual(BLANK_MANUAL);
      setByHand(false);
    } catch (cause) {
      setProblem(
        cause instanceof Error ? cause.message : "No se pudo guardar en Drive.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {created && <JustCreated souvenir={created} />}

      <SectionLabel>Nuevo lugar</SectionLabel>

      <form onSubmit={submit} className="mb-12 flex flex-col gap-4">
        {byHand ? (
          <>
            <div className="grid gap-4 sm:grid-cols-[2fr_2fr_1fr]">
              <Field label="Ciudad">
                <input
                  {...manualField("city")}
                  placeholder="Kioto"
                  className="w-full border border-rule bg-surface px-3 py-2"
                />
              </Field>
              <Field label="País">
                <input
                  {...manualField("country")}
                  placeholder="Japón"
                  className="w-full border border-rule bg-surface px-3 py-2"
                />
              </Field>
              <Field label="ISO" hint="2 letras">
                <input
                  {...manualField("countryCode")}
                  placeholder="JP"
                  maxLength={2}
                  className="w-full border border-rule bg-surface px-3 py-2 font-mono uppercase"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Latitud">
                <input
                  {...manualField("lat")}
                  inputMode="decimal"
                  placeholder="35.0116"
                  className="w-full border border-rule bg-surface px-3 py-2 font-mono tabular-nums"
                />
              </Field>
              <Field label="Longitud">
                <input
                  {...manualField("lng")}
                  inputMode="decimal"
                  placeholder="135.7681"
                  className="w-full border border-rule bg-surface px-3 py-2 font-mono tabular-nums"
                />
              </Field>
            </div>
          </>
        ) : (
          <PlaceSearch
            selected={place}
            onPick={setPlace}
            onClear={() => setPlace(null)}
          />
        )}

        <button
          type="button"
          onClick={() => {
            setByHand((current) => !current);
            setProblem(null);
          }}
          className="t-label cursor-pointer self-start text-ink-soft hover:text-accent hover:underline"
        >
          {byHand
            ? "← Volver a buscar por nombre"
            : "El lugar no aparece · introducirlo a mano"}
        </button>

        {problem && (
          <p role="alert" className="text-sm text-accent">
            {problem}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="t-display cursor-pointer self-start rounded-sm bg-accent px-5 py-3 font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? "Guardando en Drive…" : "Dar de alta"}
        </button>
      </form>
    </>
  );
}

function JustCreated({ souvenir }: { souvenir: Souvenir }) {
  // Read at render rather than stored: the origin differs between localhost
  // and the deployment, and this only ever renders after a click.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origin}/t/${souvenir.slug}`;

  return (
    <div className="mb-10 border-l-[3px] border-teal bg-teal-bg px-4 py-4">
      <p className="t-label mb-2 text-teal">Grábale esto al chip</p>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="break-all font-mono text-sm">{url}</p>
        <span className="flex items-baseline gap-4">
          <Link
            href={`/t/${souvenir.slug}`}
            className="t-label shrink-0 text-accent hover:underline"
          >
            Ver álbum
          </Link>
          <CopyButton value={url} />
        </span>
      </div>

      <p className="text-[0.9rem] text-ink-soft">
        Registro NDEF de tipo URI. Imprime también un QR diminuto al lado: el
        NFC falla con fundas gruesas y móviles viejos, y el QR no cuesta nada.
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-label text-ink-soft">
        {label}
        {hint && <span className="ml-2 normal-case tracking-normal">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

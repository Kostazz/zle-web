import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle } from "lucide-react";
import type { PaymentMethod } from "@shared/schema";

type CheckoutTotals = {
  subtotalCzk?: number | null;
  shippingCzk?: number | null;
  codCzk?: number | null;
  totalCzk?: number | null;
  shippingLabel?: string | null;
};

type CheckoutResultProps = {
  status: "success" | "cancel";
  orderId?: string | null;
  paymentMethod?: PaymentMethod | null;
  totals?: CheckoutTotals | null;
};

const formatCzk = (value?: number | null) => (typeof value === "number" ? `${value} Kč` : "—");

const getSuccessTitle = (paymentMethod?: PaymentMethod | null) => {
  switch (paymentMethod) {
    case "cod":
      return "DOBÍRKA POTVRZENA";
    case "in_person":
      return "OBJEDNÁVKA POTVRZENA";
    case "card":
    case "gpay":
    case "applepay":
      return "PLATBA POTVRZENA";
    default:
      return "OBJEDNÁVKA POTVRZENA";
  }
};

const getSuccessDescription = (paymentMethod?: PaymentMethod | null) => {
  switch (paymentMethod) {
    case "cod":
      return "Zaplatíš až při převzetí. My balíme a posíláme.";
    case "in_person":
      return "Objednávka je vytvořená. Platbu vyřešíš na místě při osobním odběru.";
    case "card":
    case "gpay":
    case "applepay":
      return "Platba proběhla úspěšně. Teď makáme my — balíme a posíláme.";
    default:
      return "Objednávka byla úspěšně vytvořena.";
  }
};

const getNextSteps = (paymentMethod?: PaymentMethod | null) => {
  switch (paymentMethod) {
    case "cod":
      return [
        "Zaplatíš při převzetí (kurýr / výdejní místo podle dopravy).",
        "Jakmile to vyrazí, pošleme ti info do mailu.",
      ];
    case "in_person":
      return [
        "Připravíme objednávku k osobnímu odběru.",
        "Platbu vyřešíš na místě při převzetí.",
      ];
    case "card":
    case "gpay":
    case "applepay":
      return [
        "Potvrzení objednávky ti dorazí na email.",
        "Do 1–2 dnů to balíme a posíláme.",
      ];
    default:
      return ["Pošleme ti další instrukce e‑mailem."];
  }
};

export function CheckoutResult({ status, orderId, paymentMethod, totals }: CheckoutResultProps) {
  const isSuccess = status === "success";
  const title = isSuccess ? getSuccessTitle(paymentMethod) : "PLATBA NEPROŠLA";
  const description = isSuccess
    ? getSuccessDescription(paymentMethod)
    : "Platba nezdařena nebo zrušena. Zkontrolujte údaje a zkuste to znovu.";

  const nextSteps = isSuccess ? getNextSteps(paymentMethod) : [];

  return (
    <div className="border border-white/15 bg-black/35 p-6 md:p-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center shrink-0">
          {isSuccess ? <CheckCircle2 className="h-6 w-6 text-white" /> : <XCircle className="h-6 w-6 text-white/70" />}
        </div>
        <div>
          <h1 className="font-display text-3xl text-white tracking-tight">{title}</h1>
          <p className="font-sans text-white/60">{description}</p>
        </div>
      </div>

      <div className="border border-white/15 bg-black/30 p-4 mb-6 text-left">
        <div className="font-heading text-xs tracking-wider text-white/60 mb-2">ORDER ID</div>
        <div className="font-mono text-xs text-white/80 break-all">{orderId ?? "—"}</div>
      </div>

      <div className="grid gap-2 border border-white/15 bg-white/5 p-4 mb-6 text-sm text-white/70">
        <div className="flex items-center justify-between">
          <span>Zboží</span>
          <span>{formatCzk(totals?.subtotalCzk)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{totals?.shippingLabel ? `Doprava (${totals.shippingLabel})` : "Doprava"}</span>
          <span>{formatCzk(totals?.shippingCzk)}</span>
        </div>
        {typeof totals?.codCzk === "number" && totals.codCzk > 0 && (
          <div className="flex items-center justify-between">
            <span>Dobírka</span>
            <span>{formatCzk(totals.codCzk)}</span>
          </div>
        )}
        <div className="flex items-center justify-between pt-2 border-t border-white/10 text-white">
          <span className="font-heading">Celkem</span>
          <span className="font-sans font-bold">{formatCzk(totals?.totalCzk)}</span>
        </div>
      </div>

      {isSuccess && (
        <div className="border border-white/15 bg-black/25 p-4 mb-6">
          <div className="font-heading text-xs tracking-wider text-white/60 mb-2">CO DALŠÍHO</div>
          <ul className="text-sm text-white/70 space-y-2 list-disc pl-5">
            {nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        {isSuccess ? (
          <>
            <Button asChild className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90">
              <Link href="/shop">ZPĚT DO SHOPU</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="font-heading text-sm tracking-wider border-white/20 text-white hover:bg-white/10"
            >
              <Link href="/">HLAVNÍ STRÁNKA</Link>
            </Button>
          </>
        ) : (
          <>
            <Button asChild className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90">
              <Link href="/checkout">ZKUSIT ZNOVU</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="font-heading text-sm tracking-wider border-white/20 text-white hover:bg-white/10"
            >
              <Link href="/shop">ZPĚT DO SHOPU</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

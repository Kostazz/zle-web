import { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCart } from "@/lib/cart-context";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ShoppingBag, Loader2, CreditCard, Landmark, Wallet, Bitcoin, Coins, HandCoins } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { appendOrder, type ZleOrder } from "@/utils/orderStorage";
import type { PaymentMethod, CartItem } from "@shared/schema";
import type { ShippingMethodId } from "@shared/config/shipping";

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: typeof CreditCard }[] = [
  { value: "card", label: "Platba kartou (online)", icon: CreditCard },
  { value: "cod", label: "Dobírka (platíš při převzetí)", icon: HandCoins },
  { value: "in_person", label: "Platba na místě (osobní odběr)", icon: HandCoins },
  { value: "bank", label: "Bankovní převod", icon: Landmark },
  { value: "gpay", label: "Google Pay", icon: Wallet },
  { value: "applepay", label: "Apple Pay", icon: Wallet },
  { value: "usdc", label: "USDC (krypto)", icon: Coins },
  { value: "btc", label: "Bitcoin (BTC)", icon: Bitcoin },
  { value: "eth", label: "Ethereum (ETH)", icon: Coins },
  { value: "sol", label: "Solana (SOL)", icon: Coins },
  { value: "pi", label: "Pi Network (PI)", icon: Coins },
];

const CRYPTO_NETWORKS: Record<string, { value: string; label: string }[]> = {
  usdc: [
    { value: "ethereum", label: "Ethereum (USDC)" },
    { value: "solana", label: "Solana (USDC)" },
  ],
  btc: [{ value: "bitcoin", label: "Bitcoin mainnet" }],
  eth: [{ value: "ethereum-mainnet", label: "Ethereum mainnet" }],
  sol: [{ value: "solana-mainnet", label: "Solana mainnet" }],
  pi: [{ value: "pi-mainnet", label: "Pi Network (Mainnet)" }],
};

const CRYPTO_METHODS = ["usdc", "btc", "eth", "sol", "pi"];

const buildIdempotencyPayload = (
  items: CartItem[],
  email: string,
  shipping: ShippingMethodId,
  payment: PaymentMethod
) => {
  const normalizedItems = items
    .map((item) => ({
      productId: String(item.productId),
      quantity: Number(item.quantity),
      size: item.size ? String(item.size) : null,
    }))
    .sort((a, b) => `${a.productId}:${a.size ?? ""}`.localeCompare(`${b.productId}:${b.size ?? ""}`));

  return JSON.stringify({
    items: normalizedItems,
    customerEmail: String(email).trim().toLowerCase(),
    shippingMethod: shipping,
    paymentMethod: payment,
  });
};

const sha256Hex = async (value: string) => {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

type ShippingOption = {
  id: ShippingMethodId;
  label: string;
  priceCzk: number;
  codAvailable: boolean;
  codFeeCzk: number;
  codUnavailableReason: string | null;
  allowedPaymentMethods: PaymentMethod[];
  disallowedPaymentReasons: Partial<Record<PaymentMethod, string>>;
};

type PaymentConstraints = {
  allowedPaymentMethods: PaymentMethod[];
  disallowedPaymentReasons: Partial<Record<PaymentMethod, string>>;
};

export default function Checkout() {
  const { items, total, clearCart } = useCart();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    address: "",
    city: "",
    zip: "",
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [paymentNetwork, setPaymentNetwork] = useState<string>("");
  const [shippingMethod, setShippingMethod] = useState<ShippingMethodId>("gls");
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [paymentConstraints, setPaymentConstraints] = useState<PaymentConstraints | null>(null);
  const [paymentConstraintReason, setPaymentConstraintReason] = useState<string | null>(null);
  const [submitLocked, setSubmitLocked] = useState(false);

  // Stable key to avoid quote spam (items reference can change on re-render)
  const itemsKey = useMemo(() => {
    return (items || [])
      .map((it) => `${it.productId}:${it.quantity}`)
      .sort()
      .join("|");
  }, [items]);

  const quoteTimerRef = useRef<number | null>(null);
  const quoteAbortRef = useRef<AbortController | null>(null);
  const quoteToastCooldownRef = useRef<number>(0);

  const [isRecalculating, setIsRecalculating] = useState(false);
  const [quote, setQuote] = useState<null | {
    shippingCzk: number;
    codAvailable: boolean;
    codFeeCzk: number;
    totalCzk: number;
  }>(null);

  useEffect(() => {
    setPaymentConstraints(null);
    setPaymentConstraintReason(null);
  }, [shippingMethod]);

  useEffect(() => {
    fetch("/api/shipping/options")
      .then((r) => r.json())
      .then((data) => setShippingOptions(data.shippingOptions))
      .catch(() => {
        toast({
          title: "Chyba",
          description: "Nepodařilo se načíst dopravu",
          variant: "destructive",
        });
      });
  }, [toast]);

  useEffect(() => {
    if (!items || items.length === 0) {
      setQuote(null);
      return;
    }

    // Debounce to prevent rate-limit (and UI jitter) when switching options fast
    if (quoteTimerRef.current) window.clearTimeout(quoteTimerRef.current);
    quoteTimerRef.current = window.setTimeout(async () => {
      // cancel previous in-flight request
      if (quoteAbortRef.current) quoteAbortRef.current.abort();
      const controller = new AbortController();
      quoteAbortRef.current = controller;

      setIsRecalculating(true);
      try {
        const res = await apiRequest(
          "POST",
          "/api/checkout/quote",
          { items, shippingMethod, paymentMethod },
          { signal: controller.signal } as any
        );

        // 429 = rate limit: keep UX quiet (no toast spam), just stop recalculating
        if (res.status === 429) {
          return;
        }

        const data = await res.json();

        if (!res.ok) {
          if (data?.code === "payment_not_allowed_for_shipping") {
            setPaymentConstraintReason(data?.reason ?? null);
            setQuote(null);
            return;
          }
          throw new Error(data?.error || data?.code || "quote_failed");
        }

        if (data?.shippingOptions) {
          setShippingOptions(data.shippingOptions);
        }

        if (data?.paymentConstraints) {
          setPaymentConstraints(data.paymentConstraints);
          setPaymentConstraintReason(null);
        }

        setQuote(data.totals);
      } catch (e: any) {
        // Ignore aborted requests
        if (e?.name === "AbortError") return;
        const now = Date.now();
        if (now - quoteToastCooldownRef.current > 4000) {
          quoteToastCooldownRef.current = now;
          toast({
            title: "Přepočet selhal",
            description: "Nepodařilo se ověřit ceny. Zkus to znovu.",
            variant: "destructive",
          });
        }
      } finally {
        setIsRecalculating(false);
      }
    }, 250);

    return () => {
      if (quoteTimerRef.current) window.clearTimeout(quoteTimerRef.current);
      if (quoteAbortRef.current) quoteAbortRef.current.abort();
    };
  }, [itemsKey, shippingMethod, paymentMethod]);

  const selectedShipping = shippingOptions.find((option) => option.id === shippingMethod) ?? null;
  const fallbackConstraints = selectedShipping
    ? {
        allowedPaymentMethods: selectedShipping.allowedPaymentMethods,
        disallowedPaymentReasons: selectedShipping.disallowedPaymentReasons,
      }
    : null;
  const effectivePaymentConstraints = paymentConstraints ?? fallbackConstraints;
  const allowedPaymentMethods = effectivePaymentConstraints?.allowedPaymentMethods ?? [];
  const disallowedPaymentReasons = effectivePaymentConstraints?.disallowedPaymentReasons ?? {};
  const hasPaymentConstraints = allowedPaymentMethods.length > 0;
  const isSelectedPaymentAllowed = hasPaymentConstraints ? allowedPaymentMethods.includes(paymentMethod) : false;
  const selectedPaymentReason = disallowedPaymentReasons[paymentMethod] ?? paymentConstraintReason;
  const disabledPaymentReasons = hasPaymentConstraints
    ? Array.from(
        new Set(
          PAYMENT_METHODS.filter((method) => !allowedPaymentMethods.includes(method.value))
            .map((method) => disallowedPaymentReasons[method.value])
            .filter((reason): reason is string => Boolean(reason))
        )
      )
    : [];
  const shouldShowSelectedPaymentReason =
    Boolean(selectedPaymentReason) && !disabledPaymentReasons.includes(selectedPaymentReason as string);

  const shippingPrice = quote?.shippingCzk ?? selectedShipping?.priceCzk ?? 0;

  // COD surcharge (computed by server, depends on shipping carrier)
  const codFee = paymentMethod === "cod" ? quote?.codFeeCzk ?? 0 : 0;

  const totalWithShipping = quote?.totalCzk ?? 0;

  const isCryptoMethod = CRYPTO_METHODS.includes(paymentMethod);
  const networkOptions = isCryptoMethod ? CRYPTO_NETWORKS[paymentMethod] || [] : [];
  const isInPersonPayment = paymentMethod === "in_person";

  const checkoutMutation = useMutation({
    mutationFn: async (data: {
      items: typeof items;
      customerName: string;
      customerEmail: string;
      customerAddress: string;
      customerCity: string;
      customerZip: string;
      shippingMethod: ShippingMethodId;
      paymentMethod: PaymentMethod;
      idempotencyKey: string;
    }) => {
      const response = await apiRequest("POST", "/api/checkout/create-session", data);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        clearCart();
        window.location.href = data.url;
      } else {
        setSubmitLocked(false);
        toast({
          title: "Chyba",
          description: "Nepodařilo se vytvořit platební session.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      setSubmitLocked(false);
      toast({
        title: "Chyba",
        description: error.message || "Nepodařilo se zpracovat objednávku. Zkus to znovu.",
        variant: "destructive",
      });
    },
  });

  const codMutation = useMutation({
    mutationFn: async (data: {
      items: typeof items;
      customerName: string;
      customerEmail: string;
      customerAddress: string;
      customerCity: string;
      customerZip: string;
      shippingMethod: ShippingMethodId;
      paymentMethod: PaymentMethod;
      idempotencyKey: string;
    }) => {
      const response = await apiRequest("POST", "/api/checkout/create-cod-order", data);
      return response.json();
    },
    onSuccess: (data) => {
      const orderId = data?.orderId;
      if (!orderId) {
        setSubmitLocked(false);
        toast({
          title: "Chyba",
          description: "Dobírku se nepodařilo založit. Zkus to znovu.",
          variant: "destructive",
        });
        return;
      }
      clearCart();
      window.location.href = `/checkout/success?order_id=${encodeURIComponent(orderId)}&pm=cod`;
    },
    onError: (error: Error) => {
      setSubmitLocked(false);
      toast({
        title: "Chyba",
        description: error.message || "Dobírku se nepodařilo založit. Zkus to znovu.",
        variant: "destructive",
      });
    },
  });

  const inPersonMutation = useMutation({
    mutationFn: async (data: {
      items: typeof items;
      customerName: string;
      customerEmail: string;
      customerAddress: string;
      customerCity: string;
      customerZip: string;
      shippingMethod: ShippingMethodId;
      paymentMethod: PaymentMethod;
      idempotencyKey: string;
    }) => {
      const response = await apiRequest("POST", "/api/checkout/create-in-person-order", data);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.reason || "Platbu na místě se nepodařilo založit.");
      }
      return payload;
    },
    onSuccess: (data) => {
      const orderId = data?.orderId;
      if (!orderId) {
        setSubmitLocked(false);
        toast({
          title: "Chyba",
          description: "Platbu na místě se nepodařilo založit. Zkus to znovu.",
          variant: "destructive",
        });
        return;
      }
      clearCart();
      window.location.href = `/checkout/success?order_id=${encodeURIComponent(orderId)}&pm=in_person`;
    },
    onError: (error: Error) => {
      setSubmitLocked(false);
      toast({
        title: "Chyba",
        description: error.message || "Platbu na místě se nepodařilo založit. Zkus to znovu.",
        variant: "destructive",
      });
    },
  });

  const isSubmitting = checkoutMutation.isPending || codMutation.isPending || inPersonMutation.isPending || submitLocked;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePaymentMethodChange = (value: PaymentMethod) => {
    setPaymentMethod(value);
    setPaymentNetwork("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submitLocked || isSubmitting) {
      return;
    }

    if (!formData.name || !formData.email || !formData.address || !formData.city || !formData.zip) {
      toast({
        title: "Chybí údaje",
        description: "Prosím vyplň všechny povinné údaje.",
        variant: "destructive",
      });
      return;
    }

    if (isCryptoMethod && !paymentNetwork) {
      toast({
        title: "Vyber síť",
        description: "Pro krypto platbu musíš vybrat síť.",
        variant: "destructive",
      });
      return;
    }

    if (!quote) {
      toast({
        title: "Chybí přepočet",
        description: "Nepodařilo se ověřit dopravu. Zkus to prosím znovu.",
        variant: "destructive",
      });
      return;
    }

    if (!isSelectedPaymentAllowed) {
      toast({
        title: "Platba není dostupná",
        description: selectedPaymentReason ?? "Zvolená platba není dostupná pro vybranou dopravu.",
        variant: "destructive",
      });
      return;
    }

    setSubmitLocked(true);
    toast({
      title: "Objednávka se zpracovává…",
      description: "Chvilku počkej, než tě přesměrujeme.",
    });

    let idempotencyKey: string;
    try {
      const payload = buildIdempotencyPayload(items as CartItem[], formData.email, shippingMethod, paymentMethod);
      idempotencyKey = await sha256Hex(payload);
    } catch (error) {
      setSubmitLocked(false);
      toast({
        title: "Chyba",
        description: "Nepodařilo se připravit objednávku. Zkus to znovu.",
        variant: "destructive",
      });
      return;
    }

    const orderData = {
      items,
      customerName: formData.name,
      customerEmail: formData.email,
      customerAddress: formData.address,
      customerCity: formData.city,
      customerZip: formData.zip,
      paymentMethod,
      paymentNetwork: isCryptoMethod ? paymentNetwork : undefined,
      total: totalWithShipping,
      shippingMethod,
      shippingPrice,
      codFee,
      createdAt: new Date().toISOString(),
    };

    console.log("NEW ZLE ORDER", orderData);

    const newOrder: ZleOrder = {
      id: crypto.randomUUID(),
      createdAt: orderData.createdAt,
      amount: totalWithShipping,
      shippingMethod,
      shippingPrice,
      codFee,
      currency: "CZK",
      paymentMethod,
      paymentNetwork: isCryptoMethod ? paymentNetwork : undefined,
      items,
      customerEmail: formData.email,
      customerName: formData.name,
      customerAddress: formData.address,
      customerCity: formData.city,
      customerZip: formData.zip,
    };
    appendOrder(newOrder);

    if (paymentMethod === "card" || paymentMethod === "gpay" || paymentMethod === "applepay") {
      checkoutMutation.mutate({
        items,
        customerName: formData.name,
        customerEmail: formData.email,
        customerAddress: formData.address,
        customerCity: formData.city,
        customerZip: formData.zip,
        shippingMethod,
        paymentMethod,
        idempotencyKey,
      });
    } else if (paymentMethod === "cod") {
      codMutation.mutate({
        items,
        customerName: formData.name,
        customerEmail: formData.email,
        customerAddress: formData.address,
        customerCity: formData.city,
        customerZip: formData.zip,
        shippingMethod,
        paymentMethod: "cod",
        idempotencyKey,
      });
    } else if (paymentMethod === "in_person") {
      inPersonMutation.mutate({
        items,
        customerName: formData.name,
        customerEmail: formData.email,
        customerAddress: formData.address,
        customerCity: formData.city,
        customerZip: formData.zip,
        shippingMethod,
        paymentMethod: "in_person",
        idempotencyKey,
      });
    } else {
      clearCart();
      toast({
        title: "Objednávka přijata",
        description:
          paymentMethod === "bank"
            ? "Platební údaje ti pošleme emailem."
            : `Krypto platba (${paymentMethod.toUpperCase()}) bude zpracována. Pokyny obdržíš emailem.`,
      });
      window.location.href = `/checkout/success?pm=${encodeURIComponent(paymentMethod)}`;
    }
  };

  if (items.length === 0) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-md mx-auto text-center">
              <div className="w-20 h-20 mb-6 rounded-full bg-white/5 flex items-center justify-center mx-auto">
                <ShoppingBag className="h-10 w-10 text-white/30" />
              </div>
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">KOŠÍK JE PRÁZDNÝ</h1>
              <p className="font-sans text-white/60 mb-8">Přidej něco do košíku a vrať se sem.</p>
              <Button asChild className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90">
                <Link href="/shop" data-testid="link-checkout-to-shop">
                  JÍT DO SHOPU
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-8"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="font-heading text-sm tracking-wider">ZPĚT DO SHOPU</span>
            </Link>

            <h1
              className="font-display text-4xl md:text-5xl text-white tracking-tight mb-12"
              data-testid="text-checkout-title"
            >
              OBJEDNÁVKA
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
              <div>
                <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6">TVOJE ÚDAJE</h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <Label htmlFor="name" className="font-heading text-xs text-white/60 tracking-wider">
                      JMÉNO A PŘÍJMENÍ *
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      className="mt-2 bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white"
                      placeholder="Jan Novák"
                      required
                      data-testid="input-name"
                    />
                  </div>

                  <div>
                    <Label htmlFor="email" className="font-heading text-xs text-white/60 tracking-wider">
                      EMAIL *
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="mt-2 bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white"
                      placeholder="jan@email.cz"
                      required
                      data-testid="input-email"
                    />
                  </div>

                  <div>
                    <Label htmlFor="address" className="font-heading text-xs text-white/60 tracking-wider">
                      ULICE A ČÍSLO *
                    </Label>
                    <Input
                      id="address"
                      name="address"
                      value={formData.address}
                      onChange={handleInputChange}
                      className="mt-2 bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white"
                      placeholder="Skate Street 123"
                      required
                      data-testid="input-address"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="city" className="font-heading text-xs text-white/60 tracking-wider">
                        MĚSTO *
                      </Label>
                      <Input
                        id="city"
                        name="city"
                        value={formData.city}
                        onChange={handleInputChange}
                        className="mt-2 bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white"
                        placeholder="Praha"
                        required
                        data-testid="input-city"
                      />
                    </div>
                    <div>
                      <Label htmlFor="zip" className="font-heading text-xs text-white/60 tracking-wider">
                        PSČ *
                      </Label>
                      <Input
                        id="zip"
                        name="zip"
                        value={formData.zip}
                        onChange={handleInputChange}
                        className="mt-2 bg-white/5 border-white/20 text-white placeholder:text-white/40 focus:border-white"
                        placeholder="12000"
                        required
                        data-testid="input-zip"
                      />
                    </div>
                  </div>

                  <div className="pt-6 border-t border-white/10">
                    <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6">ZPŮSOB DOPRAVY *</h2>

                    <RadioGroup
                      value={shippingMethod}
                      onValueChange={(value) => setShippingMethod(value as ShippingMethodId)}
                      className="space-y-3"
                      data-testid="radio-shipping-method"
                    >
                      {shippingOptions.map((method) => (
                        <div key={method.id} className="flex items-center justify-between gap-4">
                          <div className="flex items-center">
                            <RadioGroupItem
                              value={method.id}
                              id={`shipping-${method.id}`}
                              className="border-white/30 text-white data-[state=checked]:bg-white data-[state=checked]:border-white"
                              data-testid={`radio-shipping-${method.id}`}
                            />
                            <Label
                              htmlFor={`shipping-${method.id}`}
                              className="ml-3 cursor-pointer font-sans text-sm text-white/80 hover:text-white transition-colors"
                            >
                              {method.label}
                            </Label>
                          </div>
                          <span className="font-sans text-sm font-bold text-white">
                            {method.priceCzk === 0 ? "ZDARMA" : `${method.priceCzk} Kč`}
                          </span>
                        </div>
                      ))}
                    </RadioGroup>

                    <div className="mt-3 text-xs text-white/50 min-h-[16px]">
                      <span className={isRecalculating ? "opacity-100" : "opacity-0"}>
                        {paymentMethod === "cod" ? "Ověřujeme dostupnost dobírky…" : "Přepočítávám cenu…"}
                      </span>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-white/10">
                    <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6">ZPŮSOB PLATBY *</h2>

                    <RadioGroup
                      value={paymentMethod}
                      onValueChange={(value) => handlePaymentMethodChange(value as PaymentMethod)}
                      className="space-y-3"
                      data-testid="radio-payment-method"
                    >
                      {PAYMENT_METHODS.map((method) => {
                        const Icon = method.icon;
                        const isDisabled = !hasPaymentConstraints || !allowedPaymentMethods.includes(method.value);
                        return (
                          <div key={method.value} className="flex items-center">
                            <RadioGroupItem
                              value={method.value}
                              id={`payment-${method.value}`}
                              disabled={isDisabled}
                              className="border-white/30 text-white data-[state=checked]:bg-white data-[state=checked]:border-white"
                              data-testid={`radio-payment-${method.value}`}
                            />
                            <Label
                              htmlFor={`payment-${method.value}`}
                              className="flex items-center gap-3 ml-3 cursor-pointer font-sans text-sm text-white/80 hover:text-white transition-colors"
                            >
                              <Icon className="h-4 w-4" />
                              {method.label}
                            </Label>
                          </div>
                        );
                      })}
                    </RadioGroup>

                    {!hasPaymentConstraints && (
                      <p className="text-sm opacity-70 mt-3">Načítáme dostupné platební metody…</p>
                    )}

                    {disabledPaymentReasons.map((reason) => (
                      <p key={reason} className="text-sm opacity-70 mt-3">
                        {reason}
                      </p>
                    ))}

                    {hasPaymentConstraints && !isSelectedPaymentAllowed && shouldShowSelectedPaymentReason && (
                      <p className="text-sm opacity-70 mt-3">{selectedPaymentReason}</p>
                    )}

                    {isInPersonPayment && (
                      <p className="text-sm opacity-70 mt-3">
                        Platba na místě je dostupná při osobním odběru — potvrzení objednávky bude v dalším kroku.
                      </p>
                    )}

                    {isCryptoMethod && networkOptions.length > 0 && (
                      <div className="mt-4 ml-6 pl-4 border-l border-white/20">
                        <Label className="font-heading text-xs text-white/60 tracking-wider block mb-3">VYBER SÍŤ *</Label>
                        <Select value={paymentNetwork} onValueChange={setPaymentNetwork}>
                          <SelectTrigger
                            className="bg-white/5 border-white/20 text-white focus:border-white"
                            data-testid="select-payment-network"
                          >
                            <SelectValue placeholder="Vyber síť..." />
                          </SelectTrigger>
                          <SelectContent className="bg-black border-white/20">
                            {networkOptions.map((network) => (
                              <SelectItem
                                key={network.value}
                                value={network.value}
                                className="text-white focus:bg-white/10 focus:text-white"
                                data-testid={`select-network-${network.value}`}
                              >
                                {network.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting || !quote || !hasPaymentConstraints || !isSelectedPaymentAllowed}
                    className="w-full font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90 py-6 mt-8"
                    data-testid="button-submit-order"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {paymentMethod === "cod" ? "ZAKLÁDÁM DOBÍRKU…" : "PŘESMĚROVÁVÁM NA PLATBU…"}
                      </>
                    ) : (
                      <>
                        {paymentMethod === "card" || paymentMethod === "gpay" || paymentMethod === "applepay" ? (
                          <CreditCard className="mr-2 h-4 w-4" />
                        ) : paymentMethod === "bank" ? (
                          <Landmark className="mr-2 h-4 w-4" />
                        ) : (
                          <Coins className="mr-2 h-4 w-4" />
                        )}
                        {paymentMethod === "card" || paymentMethod === "gpay" || paymentMethod === "applepay"
                          ? "POKRAČOVAT K PLATBĚ"
                          : paymentMethod === "in_person"
                            ? "POTVRDIT OBJEDNÁVKU"
                            : "ODESLAT OBJEDNÁVKU"}
                      </>
                    )}
                  </Button>

                  <p className="font-sans text-xs text-white/40 text-center mt-4">
                    {paymentMethod === "card" || paymentMethod === "gpay" || paymentMethod === "applepay"
                      ? "Budeš přesměrován na zabezpečenou platební bránu Stripe"
                      : paymentMethod === "cod"
                        ? "Zaplatíš až při převzetí (dobírka)"
                        : paymentMethod === "in_person"
                          ? "Platba na místě je dostupná při osobním odběru"
                        : paymentMethod === "bank"
                          ? "Po odeslání ti pošleme platební údaje emailem"
                          : "Po odeslání obdržíš instrukce pro krypto platbu emailem"}
                  </p>
                </form>
              </div>

              <div>
                <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6">SHRNUTÍ</h2>

                <div className="border border-white/20 bg-white/5 p-6">
                  <div className="space-y-4 mb-6">
                    {items.map((item) => (
                      <div key={`${item.productId}-${item.size}`} className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white flex-shrink-0">
                          <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-heading text-sm font-bold text-white truncate">{item.name}</h4>
                          <p className="text-xs text-white/60">
                            {item.size} x {item.quantity}
                          </p>
                        </div>
                        <span className="font-sans text-sm font-bold text-white">{item.price * item.quantity} Kč</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-white/20 pt-4 space-y-2">
                    <div className="flex items-center justify-between text-white/70 text-sm">
                      <span>Zboží</span>
                      <span>{total} Kč</span>
                    </div>
                    <div className="flex items-center justify-between text-white/70 text-sm">
                      <span>Doprava</span>
                      <span>{shippingPrice === 0 ? "ZDARMA" : `${shippingPrice} Kč`}</span>
                    </div>

                    {/* ✅ COD surcharge row */}
                    {paymentMethod === "cod" && codFee > 0 && (
                      <div className="flex items-center justify-between text-white/70 text-sm">
                        <span>Dobírka</span>
                        <span>{codFee} Kč</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-white/10">
                      <span className="font-heading text-lg text-white">CELKEM</span>
                      <span className="font-sans text-2xl font-bold text-white" data-testid="text-checkout-total">
                        {quote ? `${totalWithShipping} Kč` : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 border border-white/10 bg-white/5">
                  <h3 className="font-heading text-xs text-white/60 tracking-wider mb-2">BEZPEČNÁ PLATBA</h3>
                  <p className="font-sans text-xs text-white/40 leading-relaxed">
                    Platba je zpracována přes Stripe - světovou jedničku v online platbách. Tvoje platební údaje nikdy
                    neukládáme.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCart } from "@/lib/cart-context";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ShoppingBag, Loader2, CreditCard } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

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

  const checkoutMutation = useMutation({
    mutationFn: async (data: {
      items: typeof items;
      customerName: string;
      customerEmail: string;
      customerAddress: string;
      customerCity: string;
      customerZip: string;
    }) => {
      const response = await apiRequest("POST", "/api/checkout/create-session", data);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        clearCart();
        window.location.href = data.url;
      } else {
        toast({
          title: "Chyba",
          description: "Nepodařilo se vytvořit platební session.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodařilo se zpracovat objednávku. Zkus to znovu.",
        variant: "destructive",
      });
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.email || !formData.address || !formData.city || !formData.zip) {
      toast({
        title: "Chybí údaje",
        description: "Prosím vyplň všechny povinné údaje.",
        variant: "destructive",
      });
      return;
    }

    checkoutMutation.mutate({
      items,
      customerName: formData.name,
      customerEmail: formData.email,
      customerAddress: formData.address,
      customerCity: formData.city,
      customerZip: formData.zip,
    });
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
              <h1 className="font-display text-3xl text-white tracking-tight mb-4">
                KOŠÍK JE PRÁZDNÝ
              </h1>
              <p className="font-sans text-white/60 mb-8">
                Přidej něco do košíku a vrať se sem.
              </p>
              <Button
                asChild
                className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
              >
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
            <Link href="/shop" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-8">
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
                <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6">
                  TVOJE ÚDAJE
                </h2>
                
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

                  <Button
                    type="submit"
                    disabled={checkoutMutation.isPending}
                    className="w-full font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90 py-6 mt-8"
                    data-testid="button-submit-order"
                  >
                    {checkoutMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        PŘESMĚROVÁVÁM NA PLATBU...
                      </>
                    ) : (
                      <>
                        <CreditCard className="mr-2 h-4 w-4" />
                        POKRAČOVAT K PLATBĚ
                      </>
                    )}
                  </Button>

                  <p className="font-sans text-xs text-white/40 text-center mt-4">
                    Budeš přesměrován na zabezpečenou platební bránu Stripe
                  </p>
                </form>
              </div>

              <div>
                <h2 className="font-heading text-lg font-bold text-white tracking-wider mb-6">
                  SHRNUTÍ
                </h2>
                
                <div className="border border-white/20 bg-white/5 p-6">
                  <div className="space-y-4 mb-6">
                    {items.map((item) => (
                      <div
                        key={`${item.productId}-${item.size}`}
                        className="flex items-center gap-4"
                      >
                        <div className="w-16 h-16 bg-white flex-shrink-0">
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-heading text-sm font-bold text-white truncate">
                            {item.name}
                          </h4>
                          <p className="text-xs text-white/60">
                            {item.size} x {item.quantity}
                          </p>
                        </div>
                        <span className="font-sans text-sm font-bold text-white">
                          {item.price * item.quantity} Kč
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-white/20 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-lg text-white">CELKEM</span>
                      <span 
                        className="font-sans text-2xl font-bold text-white"
                        data-testid="text-checkout-total"
                      >
                        {total} Kč
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 border border-white/10 bg-white/5">
                  <h3 className="font-heading text-xs text-white/60 tracking-wider mb-2">
                    BEZPEČNÁ PLATBA
                  </h3>
                  <p className="font-sans text-xs text-white/40 leading-relaxed">
                    Platba je zpracována přes Stripe - světovou jedničku v online platbách. 
                    Tvoje platební údaje nikdy neukládáme.
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

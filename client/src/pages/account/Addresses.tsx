import { useEffect, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Address } from "@shared/schema";
import { MapPin, ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function AddressSkeleton() {
  return (
    <div className="border border-white/20 bg-white/5 p-6">
      <Skeleton className="h-5 w-32 bg-white/10 mb-2" />
      <Skeleton className="h-4 w-48 bg-white/10 mb-1" />
      <Skeleton className="h-4 w-40 bg-white/10" />
    </div>
  );
}

export default function Addresses() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    city: "",
    zip: "",
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      toast({
        title: "Neprihlasen",
        description: "Pro spravu adres se musis prihlasit.",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
    }
  }, [isAuthenticated, authLoading, toast]);

  const { data: addresses, isLoading } = useQuery<Address[]>({
    queryKey: ["/api/user/addresses"],
    enabled: isAuthenticated,
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      await apiRequest("POST", "/api/user/addresses", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/addresses"] });
      setIsAddOpen(false);
      setFormData({ name: "", address: "", city: "", zip: "" });
      toast({
        title: "Adresa pridana",
        description: "Nova adresa byla uspesne ulozena.",
      });
    },
    onError: () => {
      toast({
        title: "Chyba",
        description: "Nepodarilo se pridat adresu.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/user/addresses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/addresses"] });
      toast({
        title: "Adresa smazana",
        description: "Adresa byla uspesne odstranena.",
      });
    },
    onError: () => {
      toast({
        title: "Chyba",
        description: "Nepodarilo se smazat adresu.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.address || !formData.city || !formData.zip) {
      toast({
        title: "Chybi udaje",
        description: "Vyplnte prosim vsechny udaje.",
        variant: "destructive",
      });
      return;
    }
    addMutation.mutate(formData);
  };

  if (authLoading || (!isAuthenticated && !authLoading)) {
    return (
      <Layout>
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto">
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <AddressSkeleton key={i} />
                ))}
              </div>
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
            <Link href="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-8">
              <ArrowLeft className="h-4 w-4" />
              <span className="font-heading text-sm tracking-wider">ZPET</span>
            </Link>

            <div className="flex items-center justify-between mb-12">
              <h1 className="font-display text-4xl md:text-5xl text-white tracking-tight">
                MOJE ADRESY
              </h1>
              <Button
                onClick={() => setIsAddOpen(true)}
                className="font-heading text-xs tracking-wider bg-white text-black hover:bg-white/90"
                data-testid="button-add-address"
              >
                <Plus className="h-4 w-4 mr-2" />
                PRIDAT
              </Button>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <AddressSkeleton key={i} />
                ))}
              </div>
            ) : addresses && addresses.length > 0 ? (
              <div className="space-y-4">
                {addresses.map((address) => (
                  <div 
                    key={address.id}
                    className="border border-white/20 bg-white/5 p-6 flex items-start justify-between gap-4"
                    data-testid={`address-${address.id}`}
                  >
                    <div className="flex items-start gap-4">
                      <MapPin className="h-5 w-5 text-white/60 mt-1 flex-shrink-0" />
                      <div>
                        <h3 className="font-heading text-sm font-bold text-white tracking-wider mb-1">
                          {address.name}
                        </h3>
                        <p className="font-sans text-sm text-white/70">
                          {address.address}
                        </p>
                        <p className="font-sans text-sm text-white/70">
                          {address.city}, {address.zip}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMutation.mutate(address.id)}
                      disabled={deleteMutation.isPending}
                      className="text-white/60 hover:text-red-400 hover:bg-transparent"
                      data-testid={`button-delete-address-${address.id}`}
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <div className="w-20 h-20 mb-6 rounded-full bg-white/5 flex items-center justify-center mx-auto">
                  <MapPin className="h-10 w-10 text-white/30" />
                </div>
                <h2 className="font-heading text-xl text-white mb-2">
                  ZATIM ZADNE ADRESY
                </h2>
                <p className="font-sans text-white/60 mb-8">
                  Pridej adresu pro rychlejsi objednavani.
                </p>
                <Button
                  onClick={() => setIsAddOpen(true)}
                  className="font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  PRIDAT ADRESU
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="bg-black border border-white/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-white">
              NOVA ADRESA
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Pridej novou dorucovaci adresu.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <Label htmlFor="name" className="font-heading text-xs text-white/60 tracking-wider">
                NAZEV ADRESY
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-2 bg-white/5 border-white/20 text-white"
                placeholder="Domov"
                data-testid="input-address-name"
              />
            </div>

            <div>
              <Label htmlFor="address" className="font-heading text-xs text-white/60 tracking-wider">
                ULICE A CISLO
              </Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="mt-2 bg-white/5 border-white/20 text-white"
                placeholder="Skate Street 123"
                data-testid="input-address-street"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="city" className="font-heading text-xs text-white/60 tracking-wider">
                  MESTO
                </Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="mt-2 bg-white/5 border-white/20 text-white"
                  placeholder="Praha"
                  data-testid="input-address-city"
                />
              </div>
              <div>
                <Label htmlFor="zip" className="font-heading text-xs text-white/60 tracking-wider">
                  PSC
                </Label>
                <Input
                  id="zip"
                  value={formData.zip}
                  onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                  className="mt-2 bg-white/5 border-white/20 text-white"
                  placeholder="12000"
                  data-testid="input-address-zip"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={addMutation.isPending}
              className="w-full font-heading text-sm tracking-wider bg-white text-black hover:bg-white/90 py-6 mt-6"
              data-testid="button-submit-address"
            >
              {addMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  UKLADAM...
                </>
              ) : (
                "ULOZIT ADRESU"
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

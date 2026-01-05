import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Menu,
  X,
  ShoppingBag,
  LogOut,
  Package,
  MapPin,
  Shield,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/lib/cart-context";
import { useAuth } from "@/hooks/useAuth";

import ZleLogo from "@/components/ZleLogo";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const navLinks = [
  { href: "/", label: "HOME" },
  { href: "/shop", label: "SHOP" },
  { href: "/story", label: "STORY" },
  { href: "/crew", label: "CREW" },
  { href: "/contact", label: "KONTAKT" },
];

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [location] = useLocation();
  const { itemCount, setIsOpen } = useCart();
  const { user, isAuthenticated, isLoading } = useAuth();

  const getInitials = () => {
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return "U";
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-black/80 backdrop-blur-md border-b border-white/10">
      <div className="container mx-auto pl-4 pr-7 md:pl-8 md:pr-12">
        <div className="flex items-center justify-between h-16 md:h-20">
          {/* LOGO */}
          <Link href="/" className="relative z-50 flex items-center">
            <ZleLogo />
          </Link>

          {/* DESKTOP NAV */}
          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`relative font-heading text-sm font-semibold tracking-wider transition-colors group ${
                  location === link.href
                    ? "text-white"
                    : "text-white/70 hover:text-white"
                }`}
              >
                {link.label}
                <span
                  className={`absolute -bottom-1 left-0 h-[2px] bg-white transition-all duration-300 ${
                    location === link.href
                      ? "w-full"
                      : "w-0 group-hover:w-full"
                  }`}
                />
              </Link>
            ))}
          </nav>

          {/* ACTIONS */}
          <div className="flex items-center gap-2 md:gap-4">
            {!isLoading &&
              (isAuthenticated ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative text-white hover:bg-white/10"
                    >
                      <Avatar className="h-8 w-8 border border-white/20">
                        <AvatarImage
                          src={user?.profileImageUrl || undefined}
                          alt={user?.firstName || "User"}
                        />
                        <AvatarFallback className="bg-white/10 text-white text-xs">
                          {getInitials()}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent
                    align="end"
                    className="w-48 bg-black border-white/20"
                  >
                    <div className="px-2 py-1.5">
                      <p className="text-sm font-medium text-white truncate">
                        {user?.firstName
                          ? `${user.firstName} ${user.lastName || ""}`
                          : user?.email}
                      </p>
                      {user?.email && user?.firstName && (
                        <p className="text-xs text-white/60 truncate">
                          {user.email}
                        </p>
                      )}
                    </div>

                    <DropdownMenuSeparator className="bg-white/10" />

                    <DropdownMenuItem asChild>
                      <Link
                        href="/account/orders"
                        className="flex items-center gap-2 text-white"
                      >
                        <Package className="h-4 w-4" />
                        Moje objednávky
                      </Link>
                    </DropdownMenuItem>

                    <DropdownMenuItem asChild>
                      <Link
                        href="/account/addresses"
                        className="flex items-center gap-2 text-white"
                      >
                        <MapPin className="h-4 w-4" />
                        Adresy
                      </Link>
                    </DropdownMenuItem>

                    {user?.isAdmin && (
                      <>
                        <DropdownMenuSeparator className="bg-white/10" />
                        <DropdownMenuItem asChild>
                          <Link
                            href="/admin"
                            className="flex items-center gap-2 text-white"
                          >
                            <Shield className="h-4 w-4" />
                            Admin Dashboard
                          </Link>
                        </DropdownMenuItem>
                      </>
                    )}

                    <DropdownMenuSeparator className="bg-white/10" />

                    <DropdownMenuItem asChild>
                      <a
                        href="/api/logout"
                        className="flex items-center gap-2 text-white"
                      >
                        <LogOut className="h-4 w-4" />
                        Odhlásit se
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden md:flex text-white hover:bg-white/10 font-heading text-xs tracking-wider"
                  asChild
                >
                  <a href="/api/login">PŘIHLÁSIT</a>
                </Button>
              ))}

            {/* CART */}
            <Button
              variant="ghost"
              size="icon"
              className="relative text-white hover:bg-white/10"
              onClick={() => setIsOpen(true)}
            >
              <ShoppingBag className="h-5 w-5" />
              {itemCount > 0 && (
                <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs bg-white text-black">
                  {itemCount}
                </Badge>
              )}
            </Button>

            {/* MOBILE MENU */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-white hover:bg-white/10"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* MOBILE NAV */}
      {isMenuOpen && (
        <div className="md:hidden fixed inset-0 top-16 bg-black z-30">
          <nav className="flex flex-col items-center justify-center h-full gap-8">
            {navLinks.map((link, index) => (
              <Link
                key={link.href}
                href={link.href}
                className={`font-display text-3xl tracking-wider transition-colors ${
                  location === link.href
                    ? "text-white"
                    : "text-white/60 hover:text-white"
                }`}
                style={{ animationDelay: `${index * 0.1}s` }}
                onClick={() => setIsMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

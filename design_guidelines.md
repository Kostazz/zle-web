# ZLE Design Guidelines

## Design Approach
**Underground Czech Skate Brand** - Raw, gritty aesthetic combining crew culture, zine vibe, and street authenticity. Black & white grain-heavy design with clean foreground elements.

## ZLE Hybrid Style System (H2)

### Background Layer
- Full-page black & white photo collage from `/assets/bg-collage`
- Heavy grain texture with dirty film overlay
- Low detail (faces unidentifiable)
- Opacity: 10-25%
- Subtle parallax scrolling effect
- NO color tints - pure B&W only

### Foreground Layer
- Clean white content blocks
- High contrast black typography
- Simple borders/frames
- NO gradients, NO neon effects
- Maximum contrast: black × white × textured grain

## Typography System
**Font Families:** Inter, Archivo Black, or Montserrat

- **Headlines:** Weight 700-900, ALL CAPS
- **Body Text:** Weight 300-500
- **Style:** Bold, aggressive, street-inspired
- **No friendly/rounded fonts**

## Hero Section
**Giant headline:** "JEĎ TO ZLE" (white, bold, CAPS, no effects)

**Photo Grid:** 2×3 layout featuring images from `/assets/gallery`
- Heavy grain filter
- Subtle film flicker effect
- Hover: slight zoom + light shadow
- Light animation on scroll (fade-in from background)

**Tagline:** "ZLE = český underground, crew, humor, real life."

**CTA Button:** "JDU DO SHOPU" (anchor to /shop section)

## Layout & Spacing
- Use Tailwind spacing: Primarily `p-4`, `p-6`, `p-8`, `gap-4`, `gap-6`
- Generous whitespace in foreground blocks
- Tight, gritty backgrounds
- Clean separation between sections

## Component Design

### Product Cards (Shop)
- White background with subtle drop shadow
- Product photo (clean, no background clutter)
- Name, price, size selector
- Modal on click with multiple product images
- Minimal design, focus on product

### Shopping Cart
- Icon in top-right corner with badge counter
- Slide-in drawer interface
- Add/remove quantity controls
- Running total display
- Clean, functional layout

### Navigation
- Top horizontal nav
- Underline effect on hover
- Mobile: Hamburger menu
- Routes: Home, Shop, Story, Crew, Contact

### Photo Galleries
- Grid layouts with grain overlay
- Hover effects: zoom + shadow
- Black & white treatment
- Film photography aesthetic

## Animations (Minimal & Purposeful)
- Hero grid: Gentle fade-in
- Background: Subtle parallax scroll
- Photos: Hover zoom + shadow
- Navigation: Underline transition
- **NO excessive/distracting animations**

## Images

### Asset Organization
- `/bg-collage` - Background textures
- `/gallery` - Hero and ZLE life section (best quality)
- `/merch` - Product photos (clean backgrounds)
- `/logo` - White ZLE logo + retro fire logo
- `/archive` - Timeline/story historical photos (B&W)
- `/facesafe` - Anonymized crew photos (heavy grain/blur - never in hero)

### Image Treatment
- All gallery/hero images: grain filter
- Facesafe images: grain + blur (privacy protection)
- Product images: clean white background, subtle shadow
- Archive images: horizontal slider, heavy vintage grain

## Mobile Responsive
- Hero grid: 3×2 or slider adaptation
- Hamburger menu navigation
- Minimum text size: 15-16px
- Centered CTAs
- Touch-optimized spacing

## Color Palette
**Primary:** Black (#000000) and White (#FFFFFF) only
**Accent:** None - maintain pure B&W aesthetic
**Texture:** Grain, dirt, film effects in grayscale

## Privacy & Anonymity
- All `/facesafe` images must be stylized (grain/blur/shadow)
- Never use facesafe images in hero or product sections
- Background collage faces must be unidentifiable through heavy grain/low detail

## Brand Voice
Underground × Crew × Raw × Authentic × No-BS × Czech street culture
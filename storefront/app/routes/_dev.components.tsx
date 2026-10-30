import {useState, type ReactNode} from 'react';
import type {Route} from './+types/_dev.components';
import {DeliveryZipControl} from '~/components/layout/DeliveryZipControl';
import {PromoBar} from '~/components/layout/PromoBar';
import {Accordion} from '~/components/ui/Accordion';
import {Badge} from '~/components/ui/Badge';
import {Breadcrumb} from '~/components/ui/Breadcrumb';
import {Button} from '~/components/ui/Button';
import {Card} from '~/components/ui/Card';
import {Checkbox} from '~/components/ui/Checkbox';
import {Chip} from '~/components/ui/Chip';
import {Dialog} from '~/components/ui/Dialog';
import {Drawer} from '~/components/ui/Drawer';
import {Field} from '~/components/ui/Field';
import {IconButton} from '~/components/ui/IconButton';
import {
  CartIcon,
  CheckIcon,
  GiftIcon,
  MapPinIcon,
  SearchIcon,
  ShieldCheckIcon,
  TruckIcon,
} from '~/components/ui/Icons';
import {CONTROL_CLASSES, Input} from '~/components/ui/Input';
import {Price} from '~/components/ui/Price';
import {ProgressBar} from '~/components/ui/ProgressBar';
import {QuantityStepper} from '~/components/ui/QuantityStepper';
import {Radio} from '~/components/ui/Radio';
import {Rating} from '~/components/ui/Rating';
import {Select} from '~/components/ui/Select';
import {SizeSelector, type SizeOption} from '~/components/ui/SizeSelector';
import {Skeleton, SkeletonText} from '~/components/ui/Skeleton';
import {Tabs} from '~/components/ui/Tabs';
import {ToastRegion, useToastQueue} from '~/components/ui/Toast';

// Dev-only gallery of every shared component and state (P2-06). Not reachable in a production build.
export function loader() {
  if (import.meta.env.PROD) {
    throw new Response('Not Found', {status: 404});
  }
  return null;
}

export const meta: Route.MetaFunction = () => [
  {title: 'Component gallery (development only)'},
  {name: 'robots', content: 'noindex'},
];

// Inline samples only: the catalog fixtures arrive with Phase 3A.
const SIZES: SizeOption[] = [
  {id: 'twin', label: 'Twin', dimensions: '38" x 75"', available: true},
  {id: 'twin-xl', label: 'Twin XL', dimensions: '38" x 80"', available: true},
  {id: 'full', label: 'Full', dimensions: '54" x 75"', available: true},
  {id: 'queen', label: 'Queen', dimensions: '60" x 80"', available: true},
  {id: 'king', label: 'King', dimensions: '76" x 80"', available: false},
  {
    id: 'cal-king',
    label: 'Cal King',
    dimensions: '72" x 84"',
    available: false,
    unavailableReason: 'Out of stock',
  },
];

const usd = (amount: string) => ({amount, currencyCode: 'USD'});

export default function ComponentGallery() {
  return (
    <div className="flex flex-col gap-12 py-8">
      <header>
        <h1 className="text-3xl font-bold">Component gallery</h1>
        <p className="mt-2 max-w-prose text-fg-muted">
          Development only. Every shared component in each state a shopper can
          reach. Hover cannot be shown here: hover the controls to see it. Use
          the Tab key to see the focus ring.
        </p>
      </header>
      <TokensSection />
      <TypographySection />
      <ButtonsSection />
      <FormsSection />
      <DisplaySection />
      <CardsSection />
      <ComposedSection />
      <OverlaysSection />
      <ToastsSection />
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="border-b border-line pb-2 text-2xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Sample({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-bold text-fg-muted">{label}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const SWATCHES: ReadonlyArray<{name: string; swatch: string; ink: string}> = [
  {name: 'primary-50', swatch: 'bg-primary-50', ink: 'text-ink-900'},
  {name: 'primary-100', swatch: 'bg-primary-100', ink: 'text-ink-900'},
  {name: 'primary-300', swatch: 'bg-primary-300', ink: 'text-ink-900'},
  {name: 'primary-400', swatch: 'bg-primary-400', ink: 'text-ink-900'},
  {
    name: 'primary-500 (logo red)',
    swatch: 'bg-primary-500',
    ink: 'text-white',
  },
  {name: 'primary-600', swatch: 'bg-primary-600', ink: 'text-white'},
  {name: 'primary-700', swatch: 'bg-primary-700', ink: 'text-white'},
  {name: 'primary-800', swatch: 'bg-primary-800', ink: 'text-white'},
  {name: 'primary-900', swatch: 'bg-primary-900', ink: 'text-white'},
  {name: 'accent-100', swatch: 'bg-accent-100', ink: 'text-ink-900'},
  {name: 'accent-400', swatch: 'bg-accent-400', ink: 'text-ink-900'},
  {name: 'accent-700', swatch: 'bg-accent-700', ink: 'text-white'},
  {name: 'sale-bg', swatch: 'bg-sale-bg', ink: 'text-sale-fg'},
  {name: 'sale-fg', swatch: 'bg-sale-fg', ink: 'text-white'},
  {name: 'paper (surface-muted)', swatch: 'bg-paper', ink: 'text-ink-900'},
  {name: 'paper-line (line)', swatch: 'bg-paper-line', ink: 'text-ink-900'},
  {name: 'ink-50', swatch: 'bg-ink-50', ink: 'text-ink-900'},
  {name: 'ink-100', swatch: 'bg-ink-100', ink: 'text-ink-900'},
  {name: 'ink-300', swatch: 'bg-ink-300', ink: 'text-ink-900'},
  {name: 'ink-400', swatch: 'bg-ink-400', ink: 'text-ink-900'},
  {name: 'ink-500', swatch: 'bg-ink-500', ink: 'text-white'},
  {name: 'ink-600', swatch: 'bg-ink-600', ink: 'text-white'},
  {name: 'ink-700', swatch: 'bg-ink-700', ink: 'text-white'},
  {name: 'ink-800', swatch: 'bg-ink-800', ink: 'text-white'},
  {name: 'ink-900', swatch: 'bg-ink-900', ink: 'text-white'},
  {name: 'success-bg', swatch: 'bg-success-bg', ink: 'text-success-fg'},
  {name: 'success-solid', swatch: 'bg-success-solid', ink: 'text-white'},
  {name: 'warning-bg', swatch: 'bg-warning-bg', ink: 'text-warning-fg'},
  {name: 'warning-solid', swatch: 'bg-warning-solid', ink: 'text-ink-900'},
  {name: 'error-bg', swatch: 'bg-error-bg', ink: 'text-error-fg'},
  {name: 'error-solid', swatch: 'bg-error-solid', ink: 'text-white'},
];

function TokensSection() {
  return (
    <Section id="g-tokens" title="Design tokens">
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        {SWATCHES.map((item) => (
          <li
            key={item.name}
            className={`${item.swatch} ${item.ink} rounded-choice border border-line p-3 text-sm font-bold`}
          >
            {item.name}
          </li>
        ))}
      </ul>
      <div className="grid gap-2">
        <p className="text-xs">text-xs: the quick brown fox</p>
        <p className="text-sm">text-sm: the quick brown fox</p>
        <p className="text-base">text-base: the quick brown fox</p>
        <p className="text-xl">text-xl: the quick brown fox</p>
        <p className="text-3xl font-bold">text-3xl: the quick brown fox</p>
        <p className="type-display text-2xl">
          type-display: heavy sentence-case heading look
        </p>
      </div>
      <ul className="flex flex-wrap items-center gap-4">
        <li className="rounded-sm border border-line-strong p-4">rounded-sm</li>
        <li className="rounded-choice border border-line-strong p-4">
          rounded-choice
        </li>
        <li className="rounded-card border border-line-strong p-4">
          rounded-card
        </li>
        <li className="rounded-panel border border-line-strong p-4">
          rounded-panel
        </li>
        <li className="rounded-hero border border-line-strong p-4">
          rounded-hero
        </li>
        <li className="rounded-pill border border-line-strong px-6 py-4">
          rounded-pill
        </li>
      </ul>
      <ul className="flex flex-wrap items-center gap-6 rounded-card bg-paper p-6">
        <li className="rounded-card bg-surface p-4 shadow-sm">shadow-sm</li>
        <li className="rounded-card bg-surface p-4 shadow-md">shadow-md</li>
        <li className="rounded-card bg-surface p-4 shadow-lg">shadow-lg</li>
        <li className="rounded-card bg-surface p-4 shadow-lift">
          shadow-lift (raised card)
        </li>
        <li className="rounded-card bg-surface p-4 shadow-drawer">
          shadow-drawer (deep)
        </li>
      </ul>
    </Section>
  );
}

function TypographySection() {
  return (
    <Section id="g-type" title="Typography (Plus Jakarta Sans)">
      <div className="flex flex-col gap-4">
        <p className="type-eyebrow">Sleep better, shop smarter</p>
        <p className="type-display text-hero md:text-display">
          Sleep <span className="type-mark">better.</span>
        </p>
        <p className="type-display text-hero md:text-heading">
          A highlighted phrase that wraps across{' '}
          <span className="type-mark">two or more lines of the heading</span>{' '}
          keeps its rounded ends.
        </p>
        <p className="type-display text-heading">Shop by size (heading, 40)</p>
        <p className="type-display text-title">
          TEMPUR-Cloud Mattress (title, 22)
        </p>
        <p className="text-lead text-fg-muted">
          Lead text, 17 px: compare the top brands side by side, try them in
          store, and get yours delivered and set up at home.
        </p>
        <p className="text-sm text-fg-muted">
          Small text, 14 px: delivery estimate shown at checkout.
        </p>
      </div>
      <div className="rounded-card bg-paper p-6">
        <p className="type-eyebrow">Eyebrow on warm paper</p>
        <p className="type-display text-heading">Heading on paper</p>
        <p className="text-fg-muted">
          Muted body text on paper (6.90:1).{' '}
          <span className="text-primary-500 text-lg">
            Red text on paper is 16 px and up.
          </span>
        </p>
      </div>
      <div className="on-dark rounded-card bg-ink-900 p-6 text-white">
        <p className="type-eyebrow text-primary-300">Eyebrow on a dark band</p>
        <p className="type-display text-heading">Heading on ink</p>
      </div>
    </Section>
  );
}

function ButtonsSection() {
  return (
    <Section id="g-buttons" title="Buttons">
      <Sample label="Variants (default)">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="accent">Accent</Button>
        <Button variant="pill">Pill</Button>
        <Button variant="ghost" leadingIcon={<CheckIcon className="size-5" />}>
          Ghost with icon
        </Button>
        <Button variant="secondary" shape="pill">
          Secondary pill
        </Button>
      </Sample>
      <Sample label="Redesign variants: dark, outline, amber, link">
        <Button variant="dark">Dark</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="amber">Amber</Button>
        <Button variant="link">Compare these mattresses</Button>
        <Button variant="dark" disabled>
          Dark disabled
        </Button>
        <Button variant="outline" disabled>
          Outline disabled
        </Button>
        <Button variant="outline" loading loadingLabel="Saving">
          Outline loading
        </Button>
      </Sample>
      <Sample label="Large (56 px, 12 px radius) for the hero, cart and checkout">
        <Button size="lg">Checkout securely</Button>
        <Button size="lg" variant="outline">
          View full cart
        </Button>
        <Button
          size="lg"
          variant="dark"
          leadingIcon={<ShieldCheckIcon className="size-5" />}
        >
          Dark with icon
        </Button>
      </Sample>
      <Sample label="On a red band (carries on-dark, so the focus ring is yellow): inverse and inverse-outline">
        <div
          role="group"
          aria-label="Buttons on a red band"
          className="on-dark flex w-full flex-wrap items-center gap-3 rounded-panel bg-primary-500 p-6 text-white"
        >
          <Button variant="inverse" size="lg">
            Inverse
          </Button>
          <Button variant="inverse-outline" size="lg">
            Inverse outline
          </Button>
          <Button variant="inverse" disabled>
            Inverse disabled
          </Button>
          <Button variant="inverse-outline" disabled>
            Outline disabled
          </Button>
          <Button variant="inverse" loading loadingLabel="Sending">
            Inverse loading
          </Button>
          <Button variant="inverse-outline" loading loadingLabel="Sending">
            Outline loading
          </Button>
        </div>
      </Sample>
      <Sample label="On a black band (carries on-dark): accent and white">
        <div className="on-dark flex w-full flex-wrap items-center gap-3 rounded-panel bg-ink-900 p-6 text-white">
          <Button variant="accent" size="lg">
            Accent
          </Button>
          <Button variant="accent" disabled>
            Accent disabled
          </Button>
          <Button variant="accent" loading loadingLabel="Sending">
            Accent loading
          </Button>
          <Button variant="white" size="lg">
            White on black
          </Button>
          <Button variant="white" disabled>
            White disabled
          </Button>
        </div>
      </Sample>
      <Sample label="White on the red band (carries on-dark)">
        <div className="on-dark flex w-full flex-wrap items-center gap-3 rounded-panel bg-primary-500 p-6 text-white">
          <Button variant="white" size="lg">
            White on red
          </Button>
        </div>
      </Sample>
      <Sample label="Sizes (all at least 44 px high)">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Sample>
      <Sample label="Disabled">
        <Button disabled>Primary</Button>
        <Button variant="secondary" disabled>
          Secondary
        </Button>
        <Button variant="ghost" disabled>
          Ghost
        </Button>
        <Button variant="accent" disabled>
          Accent
        </Button>
      </Sample>
      <Sample label="Loading (stays focusable, ignores clicks)">
        <Button loading>Add to cart</Button>
        <Button variant="secondary" loading loadingLabel="Saving">
          Save
        </Button>
      </Sample>
      <p className="max-w-prose text-sm text-fg-muted">
        States: default, disabled and loading are drawn above. Hover, pressed
        and focus-visible need a pointer or the Tab key (primary goes to a
        darker red on hover and darker again when pressed; the focus ring is
        blue on white and grey surfaces and yellow inside an on-dark band);
        gallery.spec.ts asserts them. A button has no error state: errors appear
        on the field or group (Form controls, Selectors) as an icon, text and a
        border, never as a red button.
      </p>
      <Sample label="Rendered as a link (router link and plain anchor)">
        <Button to="/collections/mattresses" variant="pill">
          Router link
        </Button>
        <Button href="tel:+18005550100" variant="secondary">
          Plain anchor
        </Button>
        <Button to="/" leadingIcon={<CheckIcon className="size-5" />}>
          With icon
        </Button>
      </Sample>
      <Sample label="Full width (buy box)">
        <div className="w-full max-w-sm">
          <Button fullWidth size="lg">
            Add to cart
          </Button>
        </div>
      </Sample>
      <Sample label="Icon buttons">
        <IconButton label="Search" icon={<SearchIcon />} />
        <IconButton
          label="Cart, 3 items"
          caption="Cart"
          badge={3}
          icon={<CartIcon />}
        />
        <IconButton label="Cart, 120 items" badge={120} icon={<CartIcon />} />
        <IconButton label="Delivery" icon={<TruckIcon />} variant="solid" />
        <IconButton
          label="Delivery (disabled)"
          icon={<TruckIcon />}
          variant="solid"
          disabled
        />
        <IconButton label="Search (disabled)" icon={<SearchIcon />} disabled />
        <IconButton label="Home" icon={<MapPinIcon />} to="/" />
      </Sample>
    </Section>
  );
}

function FormsSection() {
  const [color, setColor] = useState('plush');
  const [newsletter, setNewsletter] = useState(true);
  return (
    <Section id="g-forms" title="Form controls">
      <div className="grid gap-6 md:grid-cols-2">
        <Input
          label="Email"
          name="email"
          type="email"
          hint="We never share it."
        />
        <Input
          label="ZIP code"
          name="zip-error"
          defaultValue="123"
          error="Enter a 5-digit US ZIP code."
        />
        <Input label="Name" name="name" required />
        <Input
          label="Locked field"
          name="locked"
          defaultValue="Read only"
          disabled
        />
        <Select
          label="Comfort level"
          name="comfort"
          placeholder="Choose a comfort level"
          options={[
            {value: 'plush', label: 'Plush'},
            {value: 'medium', label: 'Medium'},
            {value: 'firm', label: 'Firm'},
          ]}
        />
        <Select
          label="Sort by (error)"
          name="sort"
          error="Choose an option."
          placeholder="Choose"
          options={[{value: 'price', label: 'Price'}]}
        />
        <fieldset className="flex flex-col">
          <legend className="text-sm font-bold">Feel</legend>
          {['plush', 'medium', 'firm'].map((value) => (
            <Radio
              key={value}
              name="feel"
              value={value}
              label={value.charAt(0).toUpperCase() + value.slice(1)}
              checked={color === value}
              onChange={() => setColor(value)}
            />
          ))}
          <Radio name="feel" value="x" label="Unavailable" disabled />
        </fieldset>
        <fieldset className="flex flex-col">
          <legend className="text-sm font-bold">Delivery (error)</legend>
          <Radio
            name="delivery-error"
            value="home"
            label="Home delivery"
            error="Choose a delivery method."
          />
          <Radio name="delivery-error" value="store" label="Store pickup" />
        </fieldset>
        <div className="flex flex-col">
          <Checkbox
            label="Send me sleep tips"
            checked={newsletter}
            onChange={(event) => setNewsletter(event.target.checked)}
          />
          <Checkbox label="Disabled option" disabled />
          <Checkbox
            label="I agree to the terms"
            error="You must agree to continue."
          />
        </div>
        <Field
          label="Delivery date (custom control through Field)"
          hint="Weekdays only."
        >
          {(control) => (
            <input
              {...control}
              type="date"
              name="delivery-date"
              className={CONTROL_CLASSES}
            />
          )}
        </Field>
        <Field
          label="Haul-away items (Field with an error)"
          error="Enter 1 to 3 items."
          required
        >
          {(control) => (
            <input
              {...control}
              type="text"
              inputMode="numeric"
              name="haul-away"
              defaultValue="9"
              className={CONTROL_CLASSES}
            />
          )}
        </Field>
        <fieldset className="flex flex-col gap-2 md:col-span-2">
          <legend className="mb-2 text-sm font-bold">
            How should we get it to you? (choice cards)
          </legend>
          <Radio
            name="method"
            value="home"
            label="Home delivery and setup"
            variant="card"
            defaultChecked
          />
          <Radio
            name="method"
            value="pickup"
            label="Pick up in store"
            variant="card"
          />
          <Radio
            name="method"
            value="soon"
            label="Unavailable option"
            variant="card"
            disabled
          />
          <Checkbox label="Add to compare" variant="card" />
        </fieldset>
      </div>
      <div className="rounded-card bg-paper p-6">
        <p className="mb-4 text-sm font-bold text-fg-muted">
          Fields on warm paper (finder card, cart page): white fill, 2 px border
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <Input label="ZIP code on paper" name="zip-paper" />
          <Select
            label="Feel on paper"
            name="feel-paper"
            placeholder="Any feel"
            options={[{value: 'firm', label: 'Firm'}]}
          />
        </div>
      </div>
    </Section>
  );
}

function DisplaySection() {
  return (
    <Section id="g-display" title="Display">
      <Sample label="Badges">
        <Badge variant="sale">Save $200</Badge>
        <Badge variant="gift">Free gift</Badge>
        <Badge variant="new">New</Badge>
        <Badge>Neutral</Badge>
      </Sample>
      <Sample label="Success badge and chips (neutral paper, outline for use on paper, success)">
        <Badge variant="success">Delivery included</Badge>
        <Chip>Memory foam</Chip>
        <Chip tone="outline">Firm</Chip>
        <Chip tone="success">In our delivery zone</Chip>
        <Chip icon={<GiftIcon className="size-4" />}>With a free pillow</Chip>
      </Sample>
      <Sample label="Badges as the tag line under a card image (size tag: sentence case)">
        <Badge variant="sale" size="tag">
          Save 19%
        </Badge>
        <Badge variant="gift" size="tag">
          Free pillow with this mattress
        </Badge>
      </Sample>
      <Sample label="Price: regular, from, sale, sale with savings, compact, compare-at equal to price (no sale)">
        <Price price={usd('1299.00')} />
        <Price price={usd('899.00')} prefix="From" />
        <Price price={usd('1299.00')} compareAt={usd('1599.00')} />
        <Price
          price={usd('1299.00')}
          compareAt={usd('1599.00')}
          showSavings
          size="lg"
        />
        <Price price={usd('1299.00')} compact size="sm" />
        <Price price={usd('1299.00')} compareAt={usd('1299.00')} />
      </Sample>
      <Sample label="Rating: partial, link, one review, none">
        <Rating value={4.5} count={128} />
        <Rating value={3.2} count={9} href="#g-display" />
        <Rating value={5} count={1} />
        <Rating value={null} />
      </Sample>
      <Sample label="Skeleton (loading)">
        <div className="w-full max-w-sm">
          <Skeleton className="aspect-4/3 w-full" />
          <SkeletonText className="mt-3" lines={3} />
        </div>
      </Sample>
      <Sample label="Breadcrumb">
        <Breadcrumb
          items={[
            {label: 'Home', to: '/'},
            {label: 'Mattresses', to: '/collections/mattresses'},
            {label: 'Queen mattresses'},
          ]}
        />
      </Sample>
    </Section>
  );
}

function CardsSection() {
  return (
    <Section id="g-cards" title="Cards and progress">
      <div className="grid gap-6 rounded-card bg-paper p-4 md:grid-cols-2 md:p-6">
        <Card variant="flat" as="section" aria-labelledby="g-card-flat">
          <h3 id="g-card-flat" className="type-display text-title">
            Flat card
          </h3>
          <p className="mt-2 text-fg-muted">
            White, 1 px warm hairline, 18 px radius.
          </p>
        </Card>
        <Card variant="raised" as="section" aria-labelledby="g-card-raised">
          <h3 id="g-card-raised" className="type-display text-title">
            Raised card
          </h3>
          <p className="mt-2 text-fg-muted">
            The soft lift shadow for the finder and the cart summary.
          </p>
        </Card>
        <Card variant="dashed-amber" as="section" aria-labelledby="g-card-gift">
          <div className="flex items-center gap-3">
            <Badge variant="gift">Free gift</Badge>
            <h3 id="g-card-gift" className="type-display text-title">
              Cooling pillow
            </h3>
          </div>
          <p className="mt-2 text-fg-muted">
            <s>$79.00</s> <span className="font-bold text-sale-fg">Free</span>{' '}
            with your mattress.
          </p>
        </Card>
        <Card variant="tinted" as="section" aria-labelledby="g-card-tinted">
          <h3 id="g-card-tinted" className="type-display text-title">
            Tinted card
          </h3>
          <p className="mt-2 text-fg-muted">
            Paper fill, for a strip inside a card (the protection plan).
          </p>
        </Card>
        <Card interactive as="section" aria-labelledby="g-card-hover">
          <h3 id="g-card-hover" className="type-display text-title">
            Interactive card
          </h3>
          <p className="mt-2 text-fg-muted">
            Gains the shadow on hover and lifts 2 px when motion is allowed.
          </p>
        </Card>
        <Card
          variant="flat"
          padding="none"
          as="section"
          aria-label="Padding none"
        >
          <p className="p-4 text-fg-muted">
            padding none: the content brings its own spacing.
          </p>
          <div className="flex items-center gap-3 rounded-b-card bg-paper p-4">
            <ShieldCheckIcon className="size-6" />
            <span className="font-bold">Protection plan strip</span>
          </div>
        </Card>
      </div>
      <div className="flex max-w-xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="font-bold">$300 away from free delivery</p>
          <ProgressBar
            value={70}
            label="Progress to free delivery"
            valueText="$300 away from free delivery"
          />
        </div>
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 font-bold text-success-fg">
            <CheckIcon className="size-5" />
            You have free delivery
          </p>
          <ProgressBar
            value={100}
            tone="success"
            label="Progress to free delivery (reached)"
            valueText="Free delivery reached"
          />
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-bold">Empty bar</p>
          <ProgressBar value={0} label="Progress with nothing in the cart" />
        </div>
      </div>
    </Section>
  );
}

function ComposedSection() {
  const [size, setSize] = useState<string | null>('queen');
  const [empty, setEmpty] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(2);
  const [zip, setZip] = useState<string | null>(null);
  return (
    <Section id="g-composed" title="Selectors, accordion and tabs">
      <div className="grid gap-8 md:grid-cols-2">
        <SizeSelector
          options={SIZES}
          value={size}
          onChange={setSize}
          name="gallery-size"
        />
        <SizeSelector
          legend="Size (nothing selected, with error)"
          options={SIZES}
          value={empty}
          onChange={setEmpty}
          name="gallery-size-empty"
          error="Choose a size to continue."
        />
        <Sample label="Quantity stepper: normal, at minimum, at maximum, disabled">
          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            itemName="Queen mattress"
          />
          <QuantityStepper value={1} onChange={() => {}} label="Minimum" />
          <QuantityStepper
            value={3}
            max={3}
            onChange={() => {}}
            label="Maximum"
          />
          <QuantityStepper
            value={2}
            onChange={() => {}}
            label="Locked"
            disabled
          />
        </Sample>
        <Sample label="Utility bar controls">
          <DeliveryZipControl
            zip={zip}
            onSubmit={setZip}
            onClear={() => setZip(null)}
          />
        </Sample>
      </div>
      <Sample label="Promotional bar (the page header shows the real one)">
        <div className="w-full">
          <PromoBar
            message={{text: 'Sample promotion', linkLabel: 'Details', to: '/'}}
          />
        </div>
      </Sample>
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold text-fg-muted">
            Accordion, single
          </h3>
          <Accordion
            type="single"
            defaultOpenIds={['delivery']}
            items={[
              {
                id: 'delivery',
                title: 'Delivery and shipping',
                content: <p>Placeholder text about delivery options.</p>,
              },
              {
                id: 'warranty',
                title: 'Warranty',
                content: <p>Placeholder text about the warranty.</p>,
              },
              {
                id: 'brand',
                title: 'About the brand',
                content: <p>Placeholder text about the brand.</p>,
              },
              {
                id: 'disabled',
                title: 'Disabled section',
                content: <p>Never visible.</p>,
                disabled: true,
              },
            ]}
          />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold text-fg-muted">
            Accordion, multiple
          </h3>
          <Accordion
            type="multiple"
            defaultOpenIds={['a', 'b']}
            items={[
              {id: 'a', title: 'First', content: <p>First panel.</p>},
              {id: 'b', title: 'Second', content: <p>Second panel.</p>},
              {id: 'c', title: 'Third', content: <p>Third panel.</p>},
            ]}
          />
        </div>
      </div>
      <Tabs
        label="Product information"
        tabs={[
          {id: 'overview', label: 'Overview', content: <p>Overview text.</p>},
          {id: 'specs', label: 'Specifications', content: <p>Specs text.</p>},
          {id: 'reviews', label: 'Reviews', content: <p>Reviews text.</p>},
        ]}
      />
    </Section>
  );
}

function ToastsSection() {
  const {toasts, show, dismiss} = useToastQueue();
  return (
    <Section id="g-toasts" title="Toast notifications">
      <p className="max-w-prose text-fg-muted">
        Info, success and warning are announced politely and an error
        assertively. Info has a neutral dark frame and the info icon; an error
        has a red frame and the alert icon, so the two never look alike. A toast
        closes by itself after 6 seconds (never sooner than 4), pauses while it
        is hovered or has focus, and an error stays until it is dismissed with
        its button or Escape.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={() => show({message: 'Your choice was saved.'})}
        >
          Show info toast
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            show({
              variant: 'success',
              title: 'Added to cart',
              message: 'Queen mattress',
            })
          }
        >
          Show success toast
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            show({
              variant: 'warning',
              message: 'Only 2 left in this size.',
            })
          }
        >
          Show warning toast
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            show({
              variant: 'error',
              title: 'Could not add to cart',
              message: 'Please try again.',
            })
          }
        >
          Show error toast
        </Button>
      </div>
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </Section>
  );
}

function OverlaysSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerSide, setDrawerSide] = useState<'left' | 'right' | null>(null);
  return (
    <Section id="g-overlays" title="Dialog and drawers">
      <p className="max-w-prose text-fg-muted">
        Focus moves into the panel, Tab stays inside it, Escape or the close
        button closes it and focus returns to the button that opened it.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Button variant="secondary" onClick={() => setDrawerSide('right')}>
          Open right drawer
        </Button>
        <Button variant="secondary" onClick={() => setDrawerSide('left')}>
          Open left drawer
        </Button>
      </div>
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Sample dialog"
        description="A short task in a centred panel."
      >
        <div className="flex flex-col gap-4">
          <Input label="Your name" name="dialog-name" />
          <Button onClick={() => setDialogOpen(false)}>Save</Button>
        </div>
      </Dialog>
      <Drawer
        open={drawerSide !== null}
        onClose={() => setDrawerSide(null)}
        title={drawerSide === 'left' ? 'Left drawer' : 'Right drawer'}
        countLabel="3 items"
        side={drawerSide ?? 'right'}
        footer={
          <div className="flex flex-col gap-3">
            <ProgressBar
              value={70}
              label="Progress to free delivery (drawer)"
              valueText="$300 away from free delivery"
            />
            <Button fullWidth size="lg">
              Checkout securely
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <p>Drawer content.</p>
          <Button variant="secondary" onClick={() => setDrawerSide(null)}>
            Done
          </Button>
        </div>
      </Drawer>
    </Section>
  );
}

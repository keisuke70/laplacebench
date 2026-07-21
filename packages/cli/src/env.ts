// Must be imported before laplace-engine: its logger decides
// verbosity from NODE_ENV at module load time.
process.env.NODE_ENV = process.env.NODE_ENV || "production";

export {};

# Local AI runtime

These scripts are the working Windows runtime used with this web app. They share the existing VGG-Face service between attendance verification and CCTV, validate enrollment images, append up to 20 embeddings per name, and route both services through one ngrok endpoint.

Current installation paths are specific to this machine. To restore the runtime, copy this folder contents to D:\Gesture-Recognition-master (including tmp/start-services.ps1), then run START-ALL.cmd. The separate Face API, QR project, Python runtimes, Node.js and authenticated ngrok installation must already exist at the paths in the scripts. Review paths before using another computer.

Set VITE_CCTV_API_URL to the ngrok base URL on Vercel and redeploy once. Face URL remains the same base plus /api/verify_face. Local QR validation uses the hosted QR service so signatures match the mobile generator.

No face images, embeddings, logs or credentials are included in this runtime folder. Runtime data stays in the existing local project. Recognition thresholds require evaluation with held-out footage; no accuracy percentage is claimed.

Validation: python tmp/test_cctv_profiles.py from this folder; frontend npm run build. Blank enrollment was rejected through the live API without changing profiles.
